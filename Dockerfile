# Use the official Deno image
FROM denoland/deno:alpine-2.7.14

# Install curl
RUN apk add --no-cache curl

RUN mkdir -p /app

# Set working directory
WORKDIR /app

# Copy your project files
COPY . .

# Discord hands out a different gateway host from time to time (gateway-us-east1-b, -d, …): allow them all.
# Wildcards in --allow-net need Deno 2.4+.
CMD ["deno", "run", "--allow-env", "--allow-net=0.0.0.0,api.opencollective.com,bot.opencollective.xyz,discord.com,*.discord.com,discord.gg,*.discord.gg,api.stripe.com", "--no-prompt", "src/server.ts"]