// --- Importa las librerías ---
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    downloadContentFromMessage, // Necesario para descargar archivos multimedia
} = require('@whiskeysockets/baileys');
const pino = require('pino'); 
const fs = require('fs/promises'); // Para manejar archivos de forma asíncrona
const path = require('path');
const { exec } = require('child_process'); // Para ejecutar el comando ffmpeg

// Función de retraso para esperar la conexión
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Función principal para iniciar el bot ---
async function startBot() {

    // --- Configuraciones ---
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const pairingCodeNumber = "50661723170"; // TU NÚMERO DE TELÉFONO

    // --- Inicia la conexión con WhatsApp ---
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }), 
        auth: state,
        qrMethod: 'code', // Forzar el uso del código de 8 dígitos
    });
    
    // **Esperar 3 segundos para asegurar la conexión**
    await delay(3000); 

    // **LÓGICA DE VINCULACIÓN**
    if (!sock.authState.creds.registered) {
        if (!pairingCodeNumber) {
            console.error('ERROR: El número de vinculación está vacío.');
            return;
        }
        
        const code = await sock.requestPairingCode(pairingCodeNumber); 
        console.log('----------------------------------------------------');
        console.log(`🔒 ¡CÓDIGO DE VINCULACIÓN DE 8 DÍGITOS GENERADO!`);
        console.log(`   Ingresa este código en tu teléfono lo antes posible:`);
        console.log(`   CÓDIGO: ${code}`);
        console.log('----------------------------------------------------');
    }

    // --- Manejador de conexión ---
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada por: ', lastDisconnect.error, ', reconectando: ', shouldReconnect);
            if (shouldReconnect) {
                startBot(); // Reconectar si no fue cierre de sesión
            }
        } else if (connection === 'open') {
            console.log('✅ ¡Conexión abierta! Bot listo.');
        }
    });

    // --- Guarda las credenciales de la sesión ---
    sock.ev.on('creds.update', saveCreds);

    // --- MANEJADOR DE MENSAJES ---
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const prefix = '.';
        if (!text.startsWith(prefix)) return;

        const [command, ...args] = text.slice(prefix.length).trim().split(/ +/);
        const conn = sock; 
        const reply = (text) => sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

        switch (command.toLowerCase()) {
            
            case 'ping':
                await reply('¡Pong! 🏓');
                break;

            // ▼▼▼ COMANDO STICKER CORREGIDO ▼▼▼
            case 'sticker':
            case 's': {
                await conn.sendMessage(msg.key.remoteJid, { react: { text: '🔄', key: msg.key } });

                let quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                let mime = quoted?.imageMessage ? 'imageMessage' : quoted?.videoMessage ? 'videoMessage' : null;
                
                if (!mime) {
                    mime = msg.message?.imageMessage ? 'imageMessage' : msg.message?.videoMessage ? 'videoMessage' : null;
                }

                if (!mime) {
                    return reply('❌ Debes responder o enviar una **imagen**, **GIF** o **video** (máx. 10 segundos) para crear un sticker.');
                }
                
                try {
                    const messageContent = quoted ? quoted[mime] : msg.message[mime];
                    
                    // 1. Descargar el archivo
                    const stream = await downloadContentFromMessage(messageContent, mime.includes('video') ? 'video' : 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    // 2. Guardar archivo temporal
                    const inputPath = path.join('/tmp', `input-${Date.now()}.${mime.includes('video') ? 'mp4' : 'jpg'}`);
                    const outputPath = path.join('/tmp', `output-${Date.now()}.webp`);
                    await fs.writeFile(inputPath, buffer);

                    let ffmpegCommand;
                    
                    if (mime.includes('image')) {
                        // **SOLUCIÓN:** Usar -vframes 1 y filtros de relleno para crear WebP estático
                        ffmpegCommand = `ffmpeg -i "${inputPath}" -vframes 1 -filter:v scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:-1:-1:color=0x00000000 -vcodec libwebp -y "${outputPath}"`;
                    } else if (mime.includes('video')) {
                        // Comando para video/GIF animado
                        ffmpegCommand = `ffmpeg -i "${inputPath}" -vcodec libwebp -filter:v scale=512:512,fps=10 -ss 00:00:00 -t 00:00:10 -y "${outputPath}"`;
                    } else {
                         return reply('❌ Formato de archivo no compatible con stickers.');
                    }
                    
                    // 3. Ejecutar FFmpeg
                    await new Promise((resolve, reject) => {
                        exec(ffmpegCommand, (error, stdout, stderr) => {
                            if (error) {
                                console.error(`FFmpeg error: ${stderr}`);
                                // Muestra el output detallado de FFmpeg para ayudar en el diagnóstico de errores complejos.
                                return reject(new Error(`❌ Error al procesar el archivo. Detalle: ${stderr.substring(0, 150)}...`));
                            }
                            resolve();
                        });
                    });

                    // 4. Enviar el Sticker
                    const stickerBuffer = await fs.readFile(outputPath);
                    await conn.sendMessage(msg.key.remoteJid, { sticker: stickerBuffer });
                    
                    // 5. Limpieza y Reacción
                    await fs.unlink(inputPath);
                    await fs.unlink(outputPath);
                    await conn.sendMessage(msg.key.remoteJid, { react: { text: '✅', key: msg.key } });

                } catch (error) {
                    console.error('Error en el comando sticker:', error);
                    reply(`❌ Error al crear el sticker: ${error.message || 'Intenta con un archivo más pequeño.'}`);
                }
            }
            break;
            // ▲▲▲ FIN COMANDO STICKER CORREGIDO ▲▲▲
        }
    });
}

// --- Iniciar el bot ---
startBot();