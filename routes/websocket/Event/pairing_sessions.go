package Event

import (
	"crypto/rand"
	"encoding/hex"
	"sync"

	"github.com/gorilla/websocket"
)

// AuthorizeRequest represents companion authorization request details.
type AuthorizeRequest struct {
	SessionID       string `json:"sessionId"`
	ClientSessionID string `json:"clientSessionId"`
	ClientAuthToken string `json:"clientAuthToken"`
	ClientIsEmail   string `json:"clientIsEmail"`
	ClientData      string `json:"clientData"`
}

// GenerateCompanionAPIKey generates a random companion API key starting with ng_mac_
func GenerateCompanionAPIKey() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "ng_mac_" + hex.EncodeToString(bytes), nil
}

// Generate8DigitCode generates a random 8-digit session code.
func Generate8DigitCode() (string, error) {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	for i := 0; i < 8; i++ {
		bytes[i] = '0' + (bytes[i] % 10)
	}
	return string(bytes), nil
}

// WSMessage represents the WebSocket JSON message structure.
type WSMessage struct {
	Type            string `json:"type"`
	APIKey          string `json:"apiKey,omitempty"`
	ClientSessionID string `json:"clientSessionId,omitempty"`
	ClientAuthToken string `json:"clientAuthToken,omitempty"`
	ClientIsEmail   string `json:"clientIsEmail,omitempty"`
	ClientData      string `json:"clientData,omitempty"`
	Error           string `json:"error,omitempty"`
}

// Session represents a pending pairing WebSocket connection.
type Session struct {
	Conn      *websocket.Conn
	WantLogin bool
}

var (
	sessions   = make(map[string]Session)
	sessionsMu sync.RWMutex
)

// RegisterSession registers a new pairing session connection.
func RegisterSession(sessionID string, conn *websocket.Conn, wantLogin bool) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	sessions[sessionID] = Session{Conn: conn, WantLogin: wantLogin}
}

// GetSession retrieves a pairing session connection by ID.
func GetSession(sessionID string) (Session, bool) {
	sessionsMu.RLock()
	defer sessionsMu.RUnlock()
	sess, exists := sessions[sessionID]
	return sess, exists
}

// UnregisterSession removes a pairing session connection.
func UnregisterSession(sessionID string) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	delete(sessions, sessionID)
}
