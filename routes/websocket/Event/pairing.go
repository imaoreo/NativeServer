package Event

import (
	"context"
	"encoding/json"
	"strings"

	"dev.imaoreo/NativeServer/db"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/splitsecure/go-app-attest/appattest"
)

// HandleInitiatePairing generates an 8-digit SessionID and registers the pending pairing session.
func HandleInitiatePairing(c Client, rawPayload json.RawMessage, ctx context.Context) {
	var payload struct {
		WantLogin bool `json:"wantLogin"`
	}
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		c.SendError("initiate_pairing", "Invalid payload format")
		return
	}

	conn, ok := c.GetConn().(*websocket.Conn)
	if !ok {
		c.SendError("initiate_pairing", "Internal connection error")
		return
	}

	// Generate 8-digit SessionID code on the backend
	sessionID, err := Generate8DigitCode()
	if err != nil {
		c.SendError("initiate_pairing", "Failed to generate pairing code")
		return
	}

	RegisterSession(sessionID, conn, payload.WantLogin)
	c.SendSuccess("pairing_initiated", map[string]interface{}{
		"status":    "ready",
		"sessionId": sessionID,
	})
}

// HandleAuthorizeCompanion initiates authorization of the pending pairing session.
func HandleAuthorizeCompanion(
	c Client,
	rawPayload json.RawMessage,
	dbConn db.DBConnector,
	rdb redis.Cmdable,
	dbQueryConn db.DBQueryConnector,
	attestor appattest.Attestor,
	appleTeamID, appleBundleID string,
	ctx context.Context,
) {
	var payload struct {
		SessionID string `json:"sessionId"`
		// AppAttest signature verification fields
		KeyID     string `json:"keyId,omitempty"`
		Assertion string `json:"assertion,omitempty"`
		Challenge string `json:"challenge,omitempty"`
	}
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		c.SendError("authorize_companion", "Invalid payload format")
		return
	}

	// Verify primary device is authenticated
	if !c.IsAuthenticated() || c.GetAuthType() != "device_checked" {
		c.SendError("authorize_companion", "Unauthorized: Only device-checked primary devices can authorize companion devices")
		return
	}

	// Verify AppAttest signature if provided
	if payload.Assertion != "" && payload.Challenge != "" && payload.KeyID != "" {
		err := VerifyAssertionSignature(ctx, rdb, dbQueryConn, attestor, appleTeamID, appleBundleID, payload.KeyID, payload.Assertion, payload.Challenge)
		if err != nil {
			c.SendError("authorize_companion", "Invalid AppAttest signature: "+err.Error())
			return
		}
	}

	session, exists := GetSession(payload.SessionID)
	if !exists {
		c.SendError("authorize_companion", "Active pairing session not found")
		return
	}

	// If the client wants to be logged in as well
	if session.WantLogin {
		// Send prompt back to the primary device client so they can display the Yes/No dialog
		c.SendSuccess("authorize_prompt", map[string]interface{}{
			"sessionId": payload.SessionID,
			"message":   "Hey this device wants logged in",
		})
		return
	}

	// If client does NOT want login: complete pairing (API Key only) immediately
	apiKey, err := GenerateCompanionAPIKey()
	if err != nil {
		c.SendError("authorize_companion", "Failed to generate API Key")
		return
	}

	// Associate companion with the primary device's App Attest key identifier
	err = db.SaveCompanionDevice(dbConn, ctx, c.GetKeyID(), "", apiKey, "qr_code", false)
	if err != nil {
		errMsg := "Database error saving companion device"
		if strings.Contains(err.Error(), "maximum of 4 companion devices") || strings.Contains(err.Error(), "max_companion_devices") {
			errMsg = "Maximum companion devices (4) reached for this primary device"
		}
		c.SendError("authorize_companion", errMsg)
		return
	}

	// Send only pairing credentials to U
	authMsg := WSMessage{
		Type:   "authorized",
		APIKey: apiKey,
	}
	_ = session.Conn.WriteJSON(authMsg)

	UnregisterSession(payload.SessionID)
	session.Conn.Close()

	c.SendSuccess("companion_authorized", map[string]string{"status": "success", "apiKey": apiKey})
}

// HandleConfirmAuthorization handles D's Yes/No confirmation.
func HandleConfirmAuthorization(
	c Client,
	rawPayload json.RawMessage,
	dbConn db.DBConnector,
	rdb redis.Cmdable,
	dbQueryConn db.DBQueryConnector,
	attestor appattest.Attestor,
	appleTeamID, appleBundleID string,
	ctx context.Context,
) {
	var payload struct {
		SessionID       string `json:"sessionId"`
		Approved        bool   `json:"approved"` // true = Yes (Login), false = No (Pairing only)
		ClientSessionID string `json:"clientSessionId,omitempty"`
		ClientAuthToken string `json:"clientAuthToken,omitempty"`
		ClientIsEmail   string `json:"clientIsEmail,omitempty"`
		ClientData      string `json:"clientData,omitempty"`
		// AppAttest signature verification fields
		KeyID     string `json:"keyId,omitempty"`
		Assertion string `json:"assertion,omitempty"`
		Challenge string `json:"challenge,omitempty"`
	}
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		c.SendError("confirm_authorization", "Invalid payload format")
		return
	}

	// Verify primary device is authenticated
	if !c.IsAuthenticated() || c.GetAuthType() != "device_checked" {
		c.SendError("confirm_authorization", "Unauthorized: Only device-checked primary devices can confirm companion devices")
		return
	}

	// Verify AppAttest signature if provided
	if payload.Assertion != "" && payload.Challenge != "" && payload.KeyID != "" {
		err := VerifyAssertionSignature(ctx, rdb, dbQueryConn, attestor, appleTeamID, appleBundleID, payload.KeyID, payload.Assertion, payload.Challenge)
		if err != nil {
			c.SendError("confirm_authorization", "Invalid AppAttest signature: "+err.Error())
			return
		}
	}

	session, exists := GetSession(payload.SessionID)
	if !exists {
		c.SendError("confirm_authorization", "Active pairing session not found")
		return
	}

	apiKey, err := GenerateCompanionAPIKey()
	if err != nil {
		c.SendError("confirm_authorization", "Failed to generate API Key")
		return
	}

	// Associate companion with the primary device's App Attest key identifier
	err = db.SaveCompanionDevice(dbConn, ctx, c.GetKeyID(), "", apiKey, "qr_code", false)
	if err != nil {
		errMsg := "Database error saving companion device"
		if strings.Contains(err.Error(), "maximum of 4 companion devices") || strings.Contains(err.Error(), "max_companion_devices") {
			errMsg = "Maximum companion devices (4) reached for this primary device"
		}
		c.SendError("confirm_authorization", errMsg)
		return
	}

	var authMsg WSMessage

	if payload.Approved {
		// Yes: send API key + all login session credentials
		authMsg = WSMessage{
			Type:            "authorized",
			APIKey:          apiKey,
			ClientSessionID: payload.ClientSessionID,
			ClientAuthToken: payload.ClientAuthToken,
			ClientIsEmail:   payload.ClientIsEmail,
			ClientData:      payload.ClientData,
		}
	} else {
		// No: send only pairing API key
		authMsg = WSMessage{
			Type:   "authorized",
			APIKey: apiKey,
		}
	}

	_ = session.Conn.WriteJSON(authMsg)

	UnregisterSession(payload.SessionID)
	session.Conn.Close()

	c.SendSuccess("companion_authorized", map[string]string{"status": "success", "apiKey": apiKey})
}
