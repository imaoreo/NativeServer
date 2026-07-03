package discord

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"

	"dev.imaoreo/NativeServer/db"
	"github.com/bwmarrin/discordgo"
	"github.com/google/uuid"
)

type Bot struct {
	Session         *discordgo.Session
	DB              *sql.DB
	GuildID         string
	ReviewChannelID string
}

func NewBot(token, guildID, reviewChannelID string, databaseConn *sql.DB) (*Bot, error) {
	dg, err := discordgo.New("Bot " + token)
	if err != nil {
		return nil, fmt.Errorf("error creating Discord session: %w", err)
	}

	bot := &Bot{
		Session:         dg,
		DB:              databaseConn,
		GuildID:         guildID,
		ReviewChannelID: reviewChannelID,
	}

	dg.AddHandler(bot.handleInteraction)

	return bot, nil
}

func (b *Bot) Start() error {
	err := b.Session.Open()
	if err != nil {
		return fmt.Errorf("error opening connection: %w", err)
	}

	log.Println("Discord Bot is now running...")

	cmd := &discordgo.ApplicationCommand{
		Name:        "apply-api-key",
		Description: "Apply for a API Key",
	}

	_, err = b.Session.ApplicationCommandCreate(b.Session.State.User.ID, b.GuildID, cmd)
	if err != nil {
		return fmt.Errorf("error creating slash command: %w", err)
	}

	log.Println("Slash command /apply-api-key registered successfully.")
	return nil
}

func (b *Bot) Stop() {
	b.Session.Close()
}

func (b *Bot) handleInteraction(s *discordgo.Session, i *discordgo.InteractionCreate) {
	switch i.Type {
	case discordgo.InteractionApplicationCommand:
		b.handleSlashCommand(s, i)
	case discordgo.InteractionModalSubmit:
		b.handleModalSubmit(s, i)
	case discordgo.InteractionMessageComponent:
		b.handleButtonInteraction(s, i)
	}
}

func (b *Bot) handleSlashCommand(s *discordgo.Session, i *discordgo.InteractionCreate) {
	data := i.ApplicationCommandData()
	if data.Name == "apply-api-key" {
		modal := discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseModal,
			Data: &discordgo.InteractionResponseData{
				CustomID: "apply_api_modal",
				Title:    "API Key Application",
				Components: []discordgo.MessageComponent{
					discordgo.ActionsRow{
						Components: []discordgo.MessageComponent{
							discordgo.TextInput{
								CustomID:    "reason_input",
								Label:       "Why do you need API access?",
								Style:       discordgo.TextInputParagraph,
								Required:    true,
								Placeholder: "Please explain here...",
							},
						},
					},
				},
			},
		}

		err := s.InteractionRespond(i.Interaction, &modal)
		if err != nil {
			log.Printf("Error responding to slash command: %v", err)
		}
	}
}

func (b *Bot) handleModalSubmit(s *discordgo.Session, i *discordgo.InteractionCreate) {
	data := i.ModalSubmitData()
	if data.CustomID == "apply_api_modal" {
		reason := ""
		for _, row := range data.Components {
			if actionRow, ok := row.(*discordgo.ActionsRow); ok {
				for _, comp := range actionRow.Components {
					if textInput, ok := comp.(*discordgo.TextInput); ok {
						if textInput.CustomID == "reason_input" {
							reason = textInput.Value
						}
					}
				}
			}
		}

		var user *discordgo.User
		if i.Member != nil {
			user = i.Member.User
		} else {
			user = i.User
		}

		if user == nil {
			log.Printf("Interaction user is nil")
			return
		}

		embed := &discordgo.MessageEmbed{
			Title:       "API Key Application",
			Color:       0x3498db, // Blue
			Description: "A user has applied for a manual API key.",
			Fields: []*discordgo.MessageEmbedField{
				{
					Name:   "User",
					Value:  user.Mention(),
					Inline: true,
				},
				{
					Name:   "Discord ID",
					Value:  user.ID,
					Inline: true,
				},
				{
					Name:   "Reason",
					Value:  reason,
					Inline: false,
				},
			},
		}

		approveBtn := discordgo.Button{
			Label:    "Approve",
			Style:    discordgo.SuccessButton,
			CustomID: "approve_mac_" + user.ID,
		}
		rejectBtn := discordgo.Button{
			Label:    "Reject",
			Style:    discordgo.DangerButton,
			CustomID: "reject_mac_" + user.ID,
		}

		actionsRow := discordgo.ActionsRow{
			Components: []discordgo.MessageComponent{approveBtn, rejectBtn},
		}

		_, err := s.ChannelMessageSendComplex(b.ReviewChannelID, &discordgo.MessageSend{
			Embeds:     []*discordgo.MessageEmbed{embed},
			Components: []discordgo.MessageComponent{actionsRow},
		})
		if err != nil {
			log.Printf("Error sending application to review channel: %v", err)
			s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content: "An error occurred while submitting your application. Please try again later.",
					Flags:   discordgo.MessageFlagsEphemeral,
				},
			})
			return
		}

		err = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "Your application has been submitted successfully to the admins for review! You will receive a DM once processed.",
				Flags:   discordgo.MessageFlagsEphemeral,
			},
		})
		if err != nil {
			log.Printf("Error sending success response: %v", err)
		}
	}
}

func (b *Bot) handleButtonInteraction(s *discordgo.Session, i *discordgo.InteractionCreate) {
	data := i.MessageComponentData()
	var adminUser *discordgo.User
	if i.Member != nil {
		adminUser = i.Member.User
	} else {
		adminUser = i.User
	}

	if strings.HasPrefix(data.CustomID, "approve_mac_") {
		discordID := strings.TrimPrefix(data.CustomID, "approve_mac_")
		ctx := context.Background()

		count, err := db.GetCompanionDeviceCountByDiscordID(b.DB, ctx, discordID)
		if err != nil {
			log.Printf("Error querying companion device count: %v", err)
			s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content: "❌ Database error checking user companion limit.",
					Flags:   discordgo.MessageFlagsEphemeral,
				},
			})
			return
		}

		if count >= 4 {
			originalMessageID := i.Message.ID
			forceBtn := discordgo.Button{
				Label:    "Force Approve",
				Style:    discordgo.SuccessButton,
				CustomID: fmt.Sprintf("force_approve_mac_%s_%s", discordID, originalMessageID),
			}
			actionsRow := discordgo.ActionsRow{
				Components: []discordgo.MessageComponent{forceBtn},
			}
			s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content:    fmt.Sprintf("⚠️ User <@%s> already has %d companion devices linked (maximum limit is 4). Do you want to force override?", discordID, count),
					Components: []discordgo.MessageComponent{actionsRow},
					Flags:      discordgo.MessageFlagsEphemeral,
				},
			})
			return
		}

		apiKey := "ng_mac_" + uuid.New().String()

		err = db.SaveCompanionDevice(b.DB, ctx, "", discordID, apiKey, "discord_manual_key", false)
		if err != nil {
			log.Printf("Error saving companion device: %v", err)
			s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content: "❌ Database error saving manual key.",
					Flags:   discordgo.MessageFlagsEphemeral,
				},
			})
			return
		}

		dmChannel, err := s.UserChannelCreate(discordID)
		if err != nil {
			log.Printf("Error creating DM channel to user %s: %v", discordID, err)
		} else {
			dmMsg := fmt.Sprintf("Hello! Your manual API key application has been **APPROVED**.\n\nHere is your unique API Key:\n```\n%s\n```\n*Please copy this key into your app to link it. This key consumes 1 of your 4 companion device slots.*", apiKey)
			_, err = s.ChannelMessageSend(dmChannel.ID, dmMsg)
			if err != nil {
				log.Printf("Error sending DM to user %s: %v", discordID, err)
			}
		}

		embed := i.Message.Embeds[0]
		embed.Color = 0x2ecc71 // Green
		embed.Fields = append(embed.Fields, &discordgo.MessageEmbedField{
			Name:   "Status",
			Value:  fmt.Sprintf("Approved by %s", adminUser.Mention()),
			Inline: false,
		})

		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseUpdateMessage,
			Data: &discordgo.InteractionResponseData{
				Embeds:     []*discordgo.MessageEmbed{embed},
				Components: []discordgo.MessageComponent{},
			},
		})
	}

	if strings.HasPrefix(data.CustomID, "force_approve_mac_") {
		payload := strings.TrimPrefix(data.CustomID, "force_approve_mac_")
		parts := strings.Split(payload, "_")
		if len(parts) < 2 {
			log.Printf("Invalid force_approve_mac payload")
			return
		}
		discordID := parts[0]
		originalMessageID := parts[1]
		ctx := context.Background()

		apiKey := "ng_mac_force_" + uuid.New().String()

		err := db.SaveCompanionDevice(b.DB, ctx, "", discordID, apiKey, "discord_manual_key", true)
		if err != nil {
			log.Printf("Error saving companion device: %v", err)
			s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content: "❌ Database error saving manual key override.",
					Flags:   discordgo.MessageFlagsEphemeral,
				},
			})
			return
		}

		dmChannel, err := s.UserChannelCreate(discordID)
		if err != nil {
			log.Printf("Error creating DM channel: %v", err)
		} else {
			dmMsg := fmt.Sprintf("Hello! Your manual API key application has been **APPROVED** (Override Edition).\n\nHere is your unique API Key:\n```\n%s\n```\n*Please copy this key into your app to link it. This key bypasses your companion limit.*", apiKey)
			_, _ = s.ChannelMessageSend(dmChannel.ID, dmMsg)
		}

		// Edit original staff review message
		msg, err := s.ChannelMessage(b.ReviewChannelID, originalMessageID)
		if err == nil && len(msg.Embeds) > 0 {
			embed := msg.Embeds[0]
			embed.Color = 0x9b59b6 // Purple (override status)
			embed.Fields = append(embed.Fields, &discordgo.MessageEmbedField{
				Name:   "Status",
				Value:  fmt.Sprintf("Approved (Override) by %s", adminUser.Mention()),
				Inline: false,
			})
			_, _ = s.ChannelMessageEditComplex(&discordgo.MessageEdit{
				ID:         originalMessageID,
				Channel:    b.ReviewChannelID,
				Embeds:     &[]*discordgo.MessageEmbed{embed},
				Components: &[]discordgo.MessageComponent{}, // Remove buttons
			})
		}

		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseUpdateMessage,
			Data: &discordgo.InteractionResponseData{
				Content:    fmt.Sprintf("✅ Force override approved for <@%s>.", discordID),
				Components: []discordgo.MessageComponent{},
			},
		})
	}

	if strings.HasPrefix(data.CustomID, "reject_mac_") {
		discordID := strings.TrimPrefix(data.CustomID, "reject_mac_")

		dmChannel, err := s.UserChannelCreate(discordID)
		if err != nil {
			log.Printf("Error creating DM channel to user %s: %v", discordID, err)
		} else {
			dmMsg := "Hello. Your API key application has been reviewed and rejected by the admin team."
			_, err = s.ChannelMessageSend(dmChannel.ID, dmMsg)
			if err != nil {
				log.Printf("Error sending DM to user %s: %v", discordID, err)
			}
		}

		embed := i.Message.Embeds[0]
		embed.Color = 0xe74c3c // Red
		embed.Fields = append(embed.Fields, &discordgo.MessageEmbedField{
			Name:   "Status",
			Value:  fmt.Sprintf("Rejected by %s", adminUser.Mention()),
			Inline: false,
		})

		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseUpdateMessage,
			Data: &discordgo.InteractionResponseData{
				Embeds:     []*discordgo.MessageEmbed{embed},
				Components: []discordgo.MessageComponent{},
			},
		})
	}
}
