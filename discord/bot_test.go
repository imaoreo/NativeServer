package discord

import (
	"testing"
)

func TestBotInit(t *testing.T) {
	bot, err := NewBot("mock_token", "mock_guild", "mock_channel", nil)
	if err != nil {
		t.Fatalf("Expected nil error, got %v", err)
	}

	if bot.GuildID != "mock_guild" {
		t.Errorf("Expected guild ID to be 'mock_guild', got '%s'", bot.GuildID)
	}
	if bot.ReviewChannelID != "mock_channel" {
		t.Errorf("Expected review channel ID to be 'mock_channel', got '%s'", bot.ReviewChannelID)
	}
}
