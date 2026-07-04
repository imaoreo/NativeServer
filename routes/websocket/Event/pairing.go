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

func validatePrimaryDevice(c Client) bool {
	return c.IsAuthenticated() && c.GetAuthType() == "device_checked"
}

func verifyAssertionIfPresent(
	ctx context.Context,
	rdb redis.Cmdable,
	dbQueryConn db.DBQueryConnector,
	attestor appattest.Attestor,
	appleTeamID, appleBundleID string,
	keyID, assertion, challenge string,
) error {
	if assertion != "" && challenge != "" && keyID != "" {
		return VerifyAssertionSignature(ctx, rdb, dbQueryConn, attestor, appleTeamID, appleBundleID, keyID, assertion, challenge)
	}
	return nil
}

func createCompanionAPIKey(
	ctx context.Context,
	dbConn db.DBConnector,
	primaryKeyID string,
) (string, error) {
	apiKey, err := GenerateCompanionAPIKey()
	if err != nil {
		return "", err
	}

	err = db.SaveCompanionDevice(dbConn, ctx, primaryKeyID, "", apiKey, "qr_code", false)
	if err != nil {
		return "", err
	}
	return apiKey, nil
}

// HandleInitiatePairing generates an 8-digit SessionID and registers the pending pairing session.
func HandleInitiatePairing(c Client, rawPayload json.RawMessage, ctx context.Context) {
	var payload struct {
		WantLogin bool `json:"wantLogin"`
	}
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		c.SendError("pairing_initiated", "Invalid payload format")
		return
	}

	conn, ok := c.GetConn().(*websocket.Conn)
	if !ok {
		c.SendError("pairing_initiated", "Internal connection error")
		return
	}

	// Generate 8-digit SessionID code on the backend
	sessionID, err := Generate8DigitCode()
	if err != nil {
		c.SendError("pairing_initiated", "Failed to generate pairing code")
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
		c.SendError("companion_authorized", "Invalid payload format")
		return
	}

	if !validatePrimaryDevice(c) {
		c.SendError("companion_authorized", "Unauthorized: Only device-checked primary devices can authorize companion devices")
		return
	}

	if err := verifyAssertionIfPresent(ctx, rdb, dbQueryConn, attestor, appleTeamID, appleBundleID, payload.KeyID, payload.Assertion, payload.Challenge); err != nil {
		c.SendError("companion_authorized", "Invalid AppAttest signature: "+err.Error())
		return
	}

	session, exists := GetSession(payload.SessionID)
	if !exists {
		c.SendError("companion_authorized", "Active pairing session not found")
		return
	}

	if session.WantLogin {
		// Send prompt back to the primary device client so they can display the Yes/No dialog
		c.SendSuccess("authorize_prompt", map[string]interface{}{
			"sessionId": payload.SessionID,
			"message":   "Hey this device wants logged in",
		})
		return
	}

	apiKey, err := createCompanionAPIKey(ctx, dbConn, c.GetKeyID())
	if err != nil {
		errMsg := "Failed to create companion device"
		if strings.Contains(err.Error(), "maximum of 4 companion devices") || strings.Contains(err.Error(), "max_companion_devices") {
			errMsg = "Maximum companion devices (4) reached for this primary device"
		}
		c.SendError("companion_authorized", errMsg)
		return
	}

	// Send only pairing credentials to companion
	authMsg := WSMessage{
		Type:   "authorized",
		APIKey: apiKey,
	}
	_ = session.Conn.WriteJSON(authMsg)

	UnregisterSession(payload.SessionID)
	session.Conn.Close()

	c.SendSuccess("companion_authorized", map[string]string{"status": "success", "apiKey": apiKey})
}

// HandleConfirmAuthorization handles primary device's Yes/No confirmation.
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
		c.SendError("companion_authorized", "Invalid payload format")
		return
	}

	if !validatePrimaryDevice(c) {
		c.SendError("companion_authorized", "Unauthorized: Only device-checked primary devices can confirm companion devices")
		return
	}

	if err := verifyAssertionIfPresent(ctx, rdb, dbQueryConn, attestor, appleTeamID, appleBundleID, payload.KeyID, payload.Assertion, payload.Challenge); err != nil {
		c.SendError("companion_authorized", "Invalid AppAttest signature: "+err.Error())
		return
	}

	session, exists := GetSession(payload.SessionID)
	if !exists {
		c.SendError("companion_authorized", "Active pairing session not found")
		return
	}

	apiKey, err := createCompanionAPIKey(ctx, dbConn, c.GetKeyID())
	if err != nil {
		errMsg := "Failed to create companion device"
		if strings.Contains(err.Error(), "maximum of 4 companion devices") || strings.Contains(err.Error(), "max_companion_devices") {
			errMsg = "Maximum companion devices (4) reached for this primary device"
		}
		c.SendError("companion_authorized", errMsg)
		return
	}

	var authMsg WSMessage
	if payload.Approved {
		authMsg = WSMessage{
			Type:            "authorized",
			APIKey:          apiKey,
			ClientSessionID: payload.ClientSessionID,
			ClientAuthToken: payload.ClientAuthToken,
			ClientIsEmail:   payload.ClientIsEmail,
			ClientData:      payload.ClientData,
		}
	} else {
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
