// --- Importa las librerías ---
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    downloadContentFromMessage,
} = require('@whiskeysockets/baileys');
const pino = require('pino'); 
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');

// --- Función principal para iniciar el bot ---
async function startBot() {

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const pairingCodeNumber = "50661723170"; // tu número

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }), 
        auth: state,
        qrMethod: 'none' // NO QR
    });

    // si no está registrado → mostrar pairing code
    if (!sock.authState.creds.registered) {
        if (!pairingCodeNumber) {
            console.error('ERROR: Número vacío');
            return;
        }
        const code = await sock.requestPairingCode(pairingCodeNumber); 
        console.log('--------------------------------------------');
        console.log('🔐 INGRESA ESTE CÓDIGO EN TU WHATSAPP:');
        console.log(`   CODE: ${code}`);
        console.log('--------------------------------------------');
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Conexión abierta | Bot online.');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- MANEJADOR DE MENSAJES ---
    sock.ev.on('messages.upsert', async (m) => {
        console.log('mensaje recibido');
    });
}

startBot();

