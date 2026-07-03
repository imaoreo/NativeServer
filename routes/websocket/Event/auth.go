package Event

import (
	"context"
	"encoding/json"

	"dev.imaoreo/NativeServer/db"
)

// HandleAuth authenticates companion or manual API key clients.
func HandleAuth(c Client, rawPayload json.RawMessage, dbQueryConn db.DBQueryConnector, ctx context.Context) {
	var payload struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		c.SendError("auth", "Invalid payload format")
		return
	}

	valid, err := db.ValidateCompanionAPIKey(dbQueryConn, ctx, payload.APIKey)
	if err != nil || !valid {
		c.SendError("auth", "Invalid API key")
		return
	}

	c.Authenticate("companion_or_manual_api", "")
	c.SendSuccess("authenticated", map[string]string{"status": "success"})
}
