# Use the official Deno image
FROM denoland/deno:alpine-2.3.1

RUN mkdir -p /app

# Set working directory
WORKDIR /app

# Copy your project files
COPY . .

CMD ["deno", "run", "--allow-env", "--allow-net=0.0.0.0,discord.com,discord.gg,gateway.discord.gg,api.stripe.com", "--no-prompt", "src/server.ts"]