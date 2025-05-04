
# Use Node.js 18 as base image
FROM node:18-buster

# Set working directory
WORKDIR /app

# Create a non-root user
RUN useradd -m appuser

# Copy package files
COPY package*.json ./

# Install system dependencies
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN npm install --production

# Copy remaining app files
COPY . .

# Change ownership to non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "app.js"]
