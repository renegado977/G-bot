FROM node:18

# instalar ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

WORKDIR /opt/render/project/src

COPY package*.json ./

RUN npm install

COPY . .

CMD ["node", "index.js"]
