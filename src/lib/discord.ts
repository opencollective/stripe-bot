// src/lib/discord.ts

// Import discord.js from npm
import {
  Client,
  GatewayIntentBits,
  TextChannel,
  PermissionsBitField,
  Message,
} from "discord.js";

// Get the bot token and channel ID from environment variables
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN");
const DISCORD_CHANNEL_ID = Deno.env.get("DISCORD_CHANNEL_ID");

if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
  throw new Error(
    "DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID is not set in the environment"
  );
}

// Create a new Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Connect to Discord
const readyPromise = new Promise<void>((resolve) => {
  client.once("ready", () => {
    console.log(`Discord bot logged in as ${client.user?.tag}`);
    checkBotPermissions(DISCORD_CHANNEL_ID!);
    resolve();
  });
});

if (Deno.env.get("ENV") !== "test") {
  client.login(DISCORD_BOT_TOKEN);
}

// Expose a function to post a message to the channel
export const postToDiscordChannel = async (message: string) => {
  await readyPromise; // Ensure the client is ready
  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID!);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error("Channel not found or is not a text channel");
  }
  if (Deno.env.get("ENV") === "dryrun") {
    console.log(`\nDRYRUN: Would have posted to Discord:\n${message}\n`);
    return;
  }
  await channel.send(message);
};

// Expose a function to fetch the latest message from a channel
export async function fetchLatestMessagesFromChannel(
  channelId: string,
  limit: number = 10
): Promise<Message[]> {
  await readyPromise; // Ensure the client is ready
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error("Channel not found or is not a text channel");
  }
  const messages = await channel.messages.fetch({ limit });
  return Array.from(messages.values()) || [];
}

export async function fetchLatestMessageFromChannel(
  channelId: string
): Promise<Message | null> {
  const messages = await fetchLatestMessagesFromChannel(channelId, 1);
  return messages[0] || null;
}

/**
 * Check and log missing permissions for a bot in a specific channel.
 * @param {string} channelId - The ID of the channel to check.
 */
async function checkBotPermissions(channelId: string) {
  if (!client.channels) {
    console.error("❌ Discord Client not initialized");
    return;
  }
  try {
    const channel = await client.channels.fetch(channelId);

    if (!channel) {
      console.error(`❌ Channel with ID ${channelId} not found.`);
      return;
    }

    if (!(channel instanceof TextChannel)) {
      console.warn(
        `⚠️ Channel ${
          "id" in channel ? channel.id : "unknown"
        } is not a guild text channel; skipping permission check.`
      );
      return;
    }

    const botUserId = client.user?.id;
    if (!botUserId) {
      console.error("❌ Discord client user not available");
      return;
    }

    const botMember = await channel.guild.members.fetch(botUserId);
    const permissions = channel.permissionsFor(botMember);

    if (!permissions) {
      console.error(
        `❌ Could not resolve permissions for bot in channel ${channel.name} (${channel.id})`
      );
      return;
    }

    const requiredPermissions = [
      "ViewChannel",
      "ReadMessageHistory",
      "SendMessages",
      "EmbedLinks",
      "AttachFiles",
      "UseExternalEmojis",
      "ManageMessages", // optional, for reactions or moderation
      "AddReactions",
      "MentionEveryone",
    ];

    console.log(`🔍 Checking permissions for bot in channel: #${channel.name}`);

    const missing: string[] = [];

    requiredPermissions.forEach((perm) => {
      if (
        !permissions.has(
          PermissionsBitField.Flags[
            perm as keyof typeof PermissionsBitField.Flags
          ]
        )
      ) {
        console.warn(`❌ Missing permission: ${perm}`);
        missing.push(perm);
      } else {
        console.log(`✅ Has permission: ${perm}`);
      }
    });

    if (missing.length === 0) {
      console.log("✅ All required permissions are in place.");
    } else {
      console.warn(
        `⚠️ Missing ${missing.length} permission(s): ${missing.join(", ")}`
      );
    }
  } catch (err) {
    console.error("🚨 Error checking permissions:", err);
  }
}

export default {
  postToDiscordChannel,
  fetchLatestMessagesFromChannel,
  fetchLatestMessageFromChannel,
};
