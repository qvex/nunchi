FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm install --no-save tsx
COPY . .
CMD ["npx", "tsx", "src/index.ts"]
