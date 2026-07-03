package Event

import (
	"context"
	"encoding/json"

	"dev.imaoreo/NativeServer/db"
	"github.com/redis/go-redis/v9"
	"github.com/splitsecure/go-app-attest/appattest"
)

// Client is an interface that decodes the websocket Client dependency.
type Client interface {
	SendError(event, message string)
	SendSuccess(event string, payload interface{})
	Authenticate(authType string, keyID string)
	IsAuthenticated() bool
	GetAuthType() string
	GetKeyID() string
	GetConn() interface{} // returns *websocket.Conn
}

// Handle dispatches incoming websocket messages to their respective event handlers.
func Handle(
	c Client,
	event string,
	payload json.RawMessage,
	rdb redis.Cmdable,
	dbConn db.DBConnector,
	dbQueryConn db.DBQueryConnector,
	attestor appattest.Attestor,
	appleTeamID, appleBundleID string,
) {
	ctx := context.Background()

	switch event {
	case "get_challenge":
		HandleGetChallenge(c, rdb, ctx)
	case "verify_attestation":
		HandleVerifyAttestation(c, payload, rdb, dbConn, attestor, appleTeamID, appleBundleID, ctx)
	case "assert_identity":
		HandleAssertIdentity(c, payload, rdb, dbQueryConn, appleTeamID, appleBundleID, ctx)
	case "auth":
		HandleAuth(c, payload, dbQueryConn, ctx)
	case "initiate_pairing":
		HandleInitiatePairing(c, payload, ctx)
	case "authorize_companion":
		HandleAuthorizeCompanion(c, payload, dbConn, rdb, dbQueryConn, attestor, appleTeamID, appleBundleID, ctx)
	case "confirm_authorization":
		HandleConfirmAuthorization(c, payload, dbConn, rdb, dbQueryConn, attestor, appleTeamID, appleBundleID, ctx)
	default:
		c.SendError(event, "Unknown event")
	}
}
