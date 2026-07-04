package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"dev.imaoreo/NativeServer/db"
	"dev.imaoreo/NativeServer/routes/websocket/Event"
	"dev.imaoreo/NativeServer/routes/websocket/Send"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/splitsecure/go-app-attest/appattest"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// Client represents a single websocket client connection.
type Client struct {
	Hub      *Hub
	Conn     *websocket.Conn
	Send     chan []byte
	IsAuth   bool
	AuthType string // "device_checked", "companion_device", "manual_api_key"
	KeyID    string
}

// Implementation of Event.Client interface methods for Client

func (c *Client) SendError(event, message string) {
	Send.Error(c.Conn, event, message)
}

func (c *Client) SendSuccess(event string, payload interface{}) {
	Send.Message(c.Conn, event, payload)
}

func (c *Client) Authenticate(authType string, keyID string) {
	c.IsAuth = true
	c.AuthType = authType
	c.KeyID = keyID
}

func (c *Client) IsAuthenticated() bool {
	return c.IsAuth
}

func (c *Client) GetAuthType() string {
	return c.AuthType
}

func (c *Client) GetKeyID() string {
	return c.KeyID
}

func (c *Client) GetConn() interface{} {
	return c.Conn
}

// Hub maintains the active clients and handles broadcasting messages.
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.Mutex
}

// NewHub creates a new websocket hub.
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run executes the hub's main event loop.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Println("Websocket client registered")
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.Send)
			}
			h.mu.Unlock()
			log.Println("Websocket client unregistered")
		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

// WSIncomingMessage represents a message sent from the client to the server.
type WSIncomingMessage struct {
	Event      string          `json:"event"`
	Payload    json.RawMessage `json:"payload"`
	ClientTime int64           `json:"clientTime"`
}

// readPump pumps messages from the websocket connection to the hub.
func (c *Client) readPump(
	rdb redis.Cmdable,
	dbConn db.DBConnector,
	dbQueryConn db.DBQueryConnector,
	attestor appattest.Attestor,
	appleTeamID, appleBundleID string,
) {
	defer func() {
		c.Hub.unregister <- c
		c.Conn.Close()
	}()
	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}
		
		var incoming WSIncomingMessage
		if err := json.Unmarshal(message, &incoming); err != nil {
			log.Printf("Failed to unmarshal WS message: %v", err)
			c.SendError("error", "Malformed JSON payload")
			continue
		}

		startTime := time.Now()
		log.Printf("Received WS event: %s", incoming.Event)
		if incoming.ClientTime > 0 {
			clientTime := time.UnixMilli(incoming.ClientTime)
			log.Printf("[TIMING] Event: %s | Client Sent: %v | Server Received: %v | Transmission Time: %v",
				incoming.Event,
				clientTime.Format(time.RFC3339Nano),
				startTime.Format(time.RFC3339Nano),
				startTime.Sub(clientTime),
			)
		}
		
		Event.Handle(c, incoming.Event, incoming.Payload, rdb, dbConn, dbQueryConn, attestor, appleTeamID, appleBundleID)
		
		elapsed := time.Since(startTime)
		log.Printf("[TIMING] Event: %s | Server Process Time: %v | Client Auth State: Authed=%v, Type=%s, KeyID=%s",
			incoming.Event, elapsed, c.IsAuthenticated(), c.GetAuthType(), c.GetKeyID())
	}
}

// writePump pumps messages from the hub to the websocket connection.
func (c *Client) writePump() {
	defer func() {
		c.Conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.Send:
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}
		}
	}
}

// MakeWebsocketHandler returns a http.HandlerFunc to handle websocket requests.
func MakeWebsocketHandler(
	hub *Hub,
	rdb redis.Cmdable,
	dbConn db.DBConnector,
	dbQueryConn db.DBQueryConnector,
	attestor appattest.Attestor,
	appleTeamID string,
	appleBundleID string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Optional initial query params handshake auth
		authVal := r.URL.Query().Get("token")
		if authVal == "" {
			authVal = r.URL.Query().Get("apiKey")
		}
		if authVal == "" {
			authVal = r.Header.Get("X-Companion-API-Key")
		}
		if authVal == "" {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				authVal = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}

		isAuthenticated := false
		authType := ""
		ctx := r.Context()

		if authVal != "" {
			if strings.HasPrefix(authVal, "ws_auth_") {
				tokenKey := "ws_token:" + authVal
				exists, err := rdb.Exists(ctx, tokenKey).Result()
				if err == nil && exists > 0 {
					rdb.Del(ctx, tokenKey)
					isAuthenticated = true
					authType = "device_checked"
				}
			} else if strings.HasPrefix(authVal, "ng_mac_") || strings.HasPrefix(authVal, "ng_mac_force_") {
				valid, err := db.ValidateCompanionAPIKey(dbQueryConn, ctx, authVal)
				if err == nil && valid {
					isAuthenticated = true
					authType = "companion_or_manual_api"
				}
			}
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("Failed to upgrade connection to websocket: %v", err)
			return
		}

		client := &Client{
			Hub:      hub,
			Conn:     conn,
			Send:     make(chan []byte, 256),
			IsAuth:   isAuthenticated,
			AuthType: authType,
		}
		client.Hub.register <- client

		go client.writePump()
		go client.readPump(rdb, dbConn, dbQueryConn, attestor, appleTeamID, appleBundleID)
	}
}
