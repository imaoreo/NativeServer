package companion

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"dev.imaoreo/NativeServer/db"
)

type AuthorizeRequest struct {
	SessionID       string `json:"sessionId"`
	ProfileID       string `json:"profileId"`
	ClientSessionID string `json:"clientSessionId"`
	ClientAuthToken string `json:"clientAuthToken"`
	ClientIsEmail   string `json:"clientIsEmail"`
	ClientData      string `json:"clientData"`
}

type AuthorizeResponse struct {
	Status string `json:"status"`
	APIKey string `json:"apiKey,omitempty"`
	Error  string `json:"error,omitempty"`
}

// GenerateCompanionAPIKey generates a random companion API key starting with ng_mac_
func GenerateCompanionAPIKey() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "ng_mac_" + hex.EncodeToString(bytes), nil
}

func MakeAuthorizeHandler(dbConn db.DBConnector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		deviceSignedVal := r.Context().Value("device_signed")
		if deviceSignedVal == nil || deviceSignedVal.(bool) != true {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(AuthorizeResponse{
				Status: "failed",
				Error:  "Unauthorized: Invalid device attestation assertion",
			})
			return
		}

		isCompanionKeyVal := r.Context().Value("is_companion_key")
		if isCompanionKeyVal != nil && isCompanionKeyVal.(bool) == true {
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(AuthorizeResponse{
				Status: "failed",
				Error:  "Forbidden: Companion keys cannot authorize other companion devices",
			})
			return
		}

		var req AuthorizeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(AuthorizeResponse{
				Status: "failed",
				Error:  "Invalid JSON payload",
			})
			return
		}

		if req.SessionID == "" || req.ProfileID == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(AuthorizeResponse{
				Status: "failed",
				Error:  "sessionId and profileId are required",
			})
			return
		}

		// 2. Check if the WebSocket session exists
		session, exists := GetSession(req.SessionID)
		if !exists {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(AuthorizeResponse{
				Status: "failed",
				Error:  "Active session not found",
			})
			return
		}

		// 3. Generate a new companion API key
		apiKey, err := GenerateCompanionAPIKey()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(AuthorizeResponse{
				Status: "failed",
				Error:  "Failed to generate API Key",
			})
			return
		}

		// 4. Save the Companion Device to the database
		ctx := r.Context()
		err = db.SaveCompanionDevice(dbConn, ctx, req.ProfileID, "", apiKey, "qr_code", false)
		if err != nil {
			log.Printf("DB error saving companion device: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			
			// Detect maximum companion devices reached
			errMsg := "Database error saving companion device"
			if strings.Contains(err.Error(), "Maximum number of companion devices") || strings.Contains(err.Error(), "max_companion_devices") {
				errMsg = "Maximum companion devices (4) reached for this profile"
			}
			
			json.NewEncoder(w).Encode(AuthorizeResponse{
				Status: "failed",
				Error:  errMsg,
			})
			return
		}

		// 5. Send the API key and profile ID over the WebSocket connection
		authMsg := WSMessage{
			Type:            "authorized",
			APIKey:          apiKey,
			ProfileID:       req.ProfileID,
			ClientSessionID: req.ClientSessionID,
			ClientAuthToken: req.ClientAuthToken,
			ClientIsEmail:   req.ClientIsEmail,
			ClientData:      req.ClientData,
		}
		if err := session.Conn.WriteJSON(authMsg); err != nil {
			log.Printf("Failed to send authorization message over WS: %v", err)
			// Unregister and return error
			UnregisterSession(req.SessionID)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(AuthorizeResponse{
				Status: "failed",
				Error:  "Failed to send credentials to the scanned client",
			})
			return
		}

		// 6. Close the websocket connection and unregister it
		UnregisterSession(req.SessionID)

		// 7. Return success to the scanner client
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(AuthorizeResponse{
			Status: "success",
			APIKey: apiKey,
		})
	}
}
