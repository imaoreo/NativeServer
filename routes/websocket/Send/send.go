package Send

import (
	"github.com/gorilla/websocket"
)

// WSOutgoingMessage represents a message sent from the server to the client.
type WSOutgoingMessage struct {
	Event   string      `json:"event"`
	Payload interface{} `json:"payload"`
}

// Message helper formats and sends a JSON payload to a websocket connection.
func Message(conn *websocket.Conn, event string, payload interface{}) error {
	msg := WSOutgoingMessage{
		Event:   event,
		Payload: payload,
	}
	return conn.WriteJSON(msg)
}

// Error helper formats and sends an error status payload to a websocket connection.
func Error(conn *websocket.Conn, event string, errorMessage string) error {
	payload := map[string]string{
		"status": "failed",
		"error":  errorMessage,
	}
	return Message(conn, event, payload)
}
