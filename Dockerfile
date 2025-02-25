# Use the latest LTS version of Node.js for better security and stability
FROM node:22-slim

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the container
COPY package*.json ./

# Install application dependencies
RUN npm ci --omit=dev  # Excludes devDependencies for a production build

# Copy the rest of the application code to the container
COPY . .

# Expose a port if your application listens on a specific port
EXPOSE 3000 

# Define the command to run your application
CMD ["npm", "start"]
