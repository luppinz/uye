/**
 * Dibuat oleh Autoftbot pada 19 April 2025
 * Dilarang keras untuk diperjualbelikan.
 * Kalau mau ubah atau modifikasi, silakan fork saja proyeknya.
 */

const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const axios = require('axios');
const dotenv = require('dotenv');
const { createCanvas, loadImage } = require('canvas');

dotenv.config();

// Konfigurasi
const CONFIG = {
    adminId: process.env.ADMIN_ID,
    loggingGroupId: process.env.LOGGING_GROUP_ID,
    dataFile: path.join(__dirname, 'user_data.json'),
    maxRequests: 5,
    requestWindow: 60 * 60 * 1000,
    otpRequests: 3,
    otpWindow: 5 * 60 * 1000,
    qrisConfig: {
        merchantId: process.env.QRIS_MERCHANT_ID,
        apiKey: process.env.QRIS_API_KEY,
        basePrice: process.env.BASE_PRICE,
        baseQrString: process.env.QRIS_BASE_QR_STRING,
        logoPath: path.join(__dirname, 'logo.png')
    },
    otpConfig: {
        requestUrl: 'https://golang-openapi-reqotp-xltembakservice.kmsp-store.com/v1',
        apiKey: process.env.NEW_OTP_API_KEY,
        verifyUrl: 'https://golang-openapi-login-xltembakservice.kmsp-store.com/v1'
    },
    packagePurchaseConfig: {
        apiUrl: 'https://golang-openapi-packagepurchase-xltembakservice.kmsp-store.com/v1',
        apiKey: process.env.PACKAGE_PURCHASE_API_KEY
    }
};

const bot = new Telegraf(process.env.BOT_TOKEN);

function loadUser Data() {
    try {
        if (fs.existsSync(CONFIG.dataFile)) {
            return JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
        }
        return {};
    } catch (error) {
        console.error('Error loading user data:', error);
        return {};
    }
}

function saveUser Data(data) {
    try {
        fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving user data:', error);
    }
}

const unverifiedMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📱 Minta OTP', callback_data: 'minta_otp' }]
        ]
    }
};

const verifiedMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🚀 Mulai Pembelian Paket', callback_data: 'start_purchase' }],
            [{ text: '🗑️ Hapus OTP', callback_data: 'hapus_otp' }]
        ]
    }
};

const messageTracker = {};

async function sendMessage(ctx, message, options = {}) {
    try {
        const userId = ctx.from.id;
        if (messageTracker[userId]) {
            try {
                await ctx.deleteMessage(messageTracker[userId]).catch(error => {
                    console.log(`Info: Tidak bisa menghapus pesan ${messageTracker[userId]} untuk user ${userId}`);
                });
            } catch (error) {
                console.log(`Info: Gagal menghapus pesan untuk user ${userId}`);
            }
        }
        const newMessage = await ctx.reply(message, {
            parse_mode: 'Markdown',
            ...options
        });
        messageTracker[userId] = newMessage.message_id;
        return newMessage;
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}

const messageTemplates = {
    welcome: (isVerified) => `
╭─〔 MENU UTAMA 〕────────────╮
│ 👋 Selamat datang di *DOR*!
│ Status: ${isVerified ? '✅ Terverifikasi' : '❌ Belum Verifikasi'}
│
├─〔 MENU 〕─────────────────
│ ${isVerified ? '🚀 Mulai Pembelian Paket' : '📱 Minta OTP'}
│
│ Jika Otp Tidak Masuk Coba lagi dengan request ulang
│
├─〔 PERHATIAN 〕────────────
│ ⚠️ Hindari semua jenis kuota XTRA COMBO sebelum order:
│   ❌ XTRA COMBO
│   ❌ XTRA COMBO VIP
│   ❌ XTRA COMBO MINI
│   ❌ XTRA COMBO VIP PLUS
│ ⚠️ Lakukan UNREG dulu agar tidak bentrok.
│ Cara UNREG XTRA Combo:
│ 1. Dial \`*808#\`
│ 2. Pilih Info
│ 3. Pilih Info Kartu XL-ku
│ 4. Pilih Stop Langganan
│ ⚠️ Lakukan pembayaran dalam 5 menit
│ ⚠️ Jangan bagikan kode OTP
╰────────────────────────────╯`,

    otpRequest: `
╭─〔 MINTA OTP 〕────────────╮
│ 📱 Masukkan nomor HP Anda
│ Contoh: 6281234567890
│
├─〔 PERHATIAN 〕────────────
│ • Nomor aktif & valid
│ • Bisa menerima SMS
│ • Format: 628xxxxxxxxxx
╰────────────────────────────╯`,

    otpSent: (phoneNumber) => `
╭─〔 OTP TERKIRIM 〕─────────╮
│ OTP telah dikirim ke:
│ 📱 ${phoneNumber}
│
├─〔 PETUNJUK 〕─────────────
│ • Cek SMS masuk
│ • Masukkan kode OTP
│ • Berlaku 5 menit
╰────────────────────────────╯`,

    paymentQR: (amount, reference) => `
╭─〔 PEMBAYARAN 〕────────────╮
│ 💰 Total: Rp ${amount}
│ 📝 Ref: ${reference}
│ ⏰ Batas: 5 menit
│
├─〔 PETUNJUK 〕─────────────
│ 1. Scan QR
│ 2. Bayar sesuai nominal
│ 3. Tunggu konfirmasi
╰────────────────────────────╯`,

    paymentSuccess: (amount, reference, date) => `
╭─〔 PEMBAYARAN DITERIMA 〕──╮
│ ✅ Berhasil!
│ 💰 Rp ${amount}
│ 📝 Ref: ${reference}
│ 🕒 ${date}
│
├─〔 PROSES 〕────────────────
│ ⏳ Sedang memproses pembelian paket...
│ Mohon tunggu sebentar
╰────────────────────────────╯`,

    purchaseSuccess: (phoneNumber, packageCode) => `
╭─〔 PEMBELIAN PAKET BERHASIL 〕──╮
│ ✅ Paket berhasil dibeli untuk:
│ 📱 ${phoneNumber}
│ 📦 Kode Paket: ${packageCode}
│ ⏳ Proses: ± 60 menit
╰────────────────────────────╯`,

    sessionEnd: `
╭─〔 SESI BERAKHIR 〕────────╮
│ ✅ Pembelian selesai!
│ 🔄 Data sesi dihapus
│
├─〔 UNTUK BELI PAKET LAGI 〕───────
│ 1. Klik "Minta OTP"
│ 2. Login ulang
╰────────────────────────────╯`,

    error: (message) => `
╭─〔 ERROR 〕────────────────╮
│ ${message}
│
├─〔 SOLUSI 〕───────────────
│ • Coba lagi nanti
│ • Hubungi admin jika perlu
╰────────────────────────────╯`
};

const otpErrorTemplate = (message) => `
╭─〔 GAGAL REQUEST OTP 〕────╮
│ ❌ ${message}
│
├─〔 PETUNJUK 〕─────────────
│ 1. Klik "Minta OTP"
│ 2. Masukkan nomor yang valid
╰────────────────────────────╯`;

const otpCooldownTemplate = `
╭─〔 BATAS WAKTU OTP 〕──────╮
│ ⏰ Tunggu sebentar!
│ Anda perlu menunggu 3–5 menit
│ sebelum meminta OTP lagi
│
├─〔 PETUNJUK 〕─────────────
│ • Klik "Minta OTP" setelahnya
│ • Gunakan nomor yang valid
╰────────────────────────────╯`;

bot.command('start', async (ctx) => {
    const userData = loadUser Data();
    const userId = ctx.from.id;
    const isVerified = userData[userId]?.verified;

    await sendMessage(ctx, messageTemplates.welcome(isVerified), 
        isVerified ? verifiedMenu : unverifiedMenu);
});

bot.action('minta_otp', async (ctx) => {
    try {
        const userData = loadUser Data();
        const userId = ctx.from.id;

        if (userData[userId]?.verified) {
            await sendMessage(ctx, '⚠️ Anda sudah login. Silakan gunakan menu Pembelian Paket.', verifiedMenu);
            return;
        }
        const lastRequest = userData[userId]?.lastOtpRequest || 0;
        const now = Date.now();
        const timeDiff = now - lastRequest;
        if (lastRequest > 0 && timeDiff < 3 * 60 * 1000) {
            await sendMessage(ctx, otpCooldownTemplate, unverifiedMenu);
            return;
        }
        userData[userId] = {
            ...userData[userId],
            waitingFor: 'phone_number',
            lastOtpRequest: now
        };
        saveUser Data(userData);

        await sendMessage(ctx, messageTemplates.otpRequest, {
            reply_markup: {
                force_reply: true
            }
        });
    } catch (error) {
        await sendMessage(ctx, messageTemplates.error(error.message), unverifiedMenu);
    }
});

bot.on('text', async (ctx) => {
    const userData = loadUser Data();
    const userId = ctx.from.id;
    
    if (userData[userId]?.waitingFor === 'phone_number') {
        const phoneNumber = ctx.message.text.trim();
        
        if (!/^628[0-9]{8,12}$/.test(phoneNumber)) {
            await sendMessage(ctx, messageTemplates.error('Format nomor HP tidak valid!\nGunakan format 628xxxxxxxxxx.'), {
                reply_markup: {
                    force_reply: true
                }
            });
            return;
        }

        try {
            // Request OTP dengan API baru
            const response = await axios.get(CONFIG.otpConfig.requestUrl, {
                params: {
                    api_key: CONFIG.otpConfig.apiKey,
                    phone: phoneNumber,
                    method: 'OTP'
                }
            });

            if (response.data.status === "success") {
                userData[userId] = {
                    ...userData[userId],
                    phoneNumber,
                    waitingFor: 'otp_code',
                    otpData: response.data.data // pastikan auth_id ada di sini
                };
                saveUser Data(userData);
                
                await sendMessage(ctx, messageTemplates.otpSent(phoneNumber), {
                    reply_markup: {
                        force_reply: true
                    }
                });
            } else {
                userData[userId] = {
                    ...userData[userId],
                    waitingFor: null
                };
                saveUser Data(userData);
                
                throw new Error(response.data.message || "Gagal mengirim OTP");
            }
        } catch (error) {
            userData[userId] = {
                ...userData[userId],
                waitingFor: null
            };
            saveUser Data(userData);
            if (error.message.includes("time limit") || 
                (error.response?.data?.response_text?.error && 
                 error.response.data.response_text.error.includes("time limit"))) {
                await sendMessage(ctx, otpCooldownTemplate, unverifiedMenu);
            } else {
                await sendMessage(ctx, otpErrorTemplate(error.message), unverifiedMenu);
            }
        }
    } else if (userData[userId]?.waitingFor === 'otp_code') {
        const otpCode = ctx.message.text.trim();
        
        try {
            // Verifikasi OTP dengan API baru
            const response = await axios.get(CONFIG.otpConfig.verifyUrl, {
                params: {
                    api_key: CONFIG.otpConfig.apiKey,
                    phone: userData[userId].phoneNumber,
                    method: 'OTP',
                    auth_id: userData[userId].otpData.auth_id,
                    otp: otpCode
                }
            });

            if (response.data.status === "success") {
                userData[userId] = {
                    ...userData[userId],
                    verified: true,
                    accessToken: response.data.data.access_token,
                    waitingFor: null
                };
                saveUser Data(userData);
                
                await sendMessage(ctx, `
╭─〔 VERIFIKASI BERHASIL 〕────╮
│ ✅ Login berhasil!
│ 📱 Nomor: ${userData[userId].phoneNumber}
│
├─〔 PETUNJUK 〕─────────────
│ 1. Klik "Mulai Pembelian Paket"
│ 2. Lanjutkan proses
╰────────────────────────────╯`, verifiedMenu);
            } else {
                userData[userId] = {
                    ...userData[userId],
                    waitingFor: null
                };
                saveUser Data(userData);
                
                throw new Error(response.data.message || "Gagal verifikasi OTP");
            }
        } catch (error) {
            userData[userId] = {
                ...userData[userId],
                waitingFor: null
            };
            saveUser Data(userData);
            
            await sendMessage(ctx, otpErrorTemplate(error.message), unverifiedMenu);
        }
    }
});

bot.action('start_purchase', async (ctx) => {
    const userData = loadUser Data();
    const userId = ctx.from.id;
    
    if (!userData[userId]?.verified) {
        await sendMessage(ctx, messageTemplates.error('Anda belum terverifikasi'), unverifiedMenu);
        return;
    }

    const purchaseMenu = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Konfirmasi Pembelian Paket', callback_data: 'confirm_purchase' }],
                [{ text: '❌ Batalkan', callback_data: 'cancel_purchase' }]
            ]
        }
    };
    
    await sendMessage(ctx, `
╭─〔 KONFIRMASI PEMBELIAN PAKET 〕────────────╮
│ 📱 *Detail Target:*
│ Nomor: ${userData[userId].phoneNumber}
│
├─〔 PERHATIAN 〕────────────────
│ • Pastikan nomor yang dimasukkan benar.
│ • Bayar dalam 5 menit
│ • Saldo hangus jika gagal
│ • Admin tidak bertanggung jawab jika salah
╰──────────────────────────────╯
    `, {
        ...purchaseMenu
    });
});

bot.action('confirm_purchase', async (ctx) => {
    const userData = loadUser Data();
    const userId = ctx.from.id;
    
    if (!userData[userId]?.verified) {
        await sendMessage(ctx, messageTemplates.error('Anda belum terverifikasi'), unverifiedMenu);
        return;
    }

    try {
        const packageCode = "XLUNLITURBOPREMIUMPROMO3K"; // Ganti sesuai kode paket yang diinginkan
        const paymentMethod = "BALANCE"; // Ganti sesuai metode pembayaran yang diinginkan

        // Pembelian paket dengan API baru
        const purchaseResponse = await axios.get(CONFIG.packagePurchaseConfig.apiUrl, {
            params: {
                api_key: CONFIG.packagePurchaseConfig.apiKey,
                package_code: packageCode,
                phone: userData[userId].phoneNumber,
                access_token: userData[userId].accessToken,
                payment_method: paymentMethod
            }
        });

        if (purchaseResponse.data.status === "success") {
            await sendMessage(ctx, messageTemplates.purchaseSuccess(userData[userId].phoneNumber, packageCode));
            deleteUser Data(userId); // Hapus data user setelah pembelian
            await sendMessage(ctx, messageTemplates.sessionEnd, unverifiedMenu);
        } else {
            throw new Error(purchaseResponse.data.message || "Gagal melakukan pembelian paket");
        }
    } catch (error) {
        await sendMessage(ctx, messageTemplates.error(error.message), verifiedMenu);
    }
});

bot.action('cancel_purchase', async (ctx) => {
    await sendMessage(ctx, '❌ Pembelian paket dibatalkan.', verifiedMenu);
});

bot.action('hapus_otp', async (ctx) => {
    try {
        const userData = loadUser Data();
        const userId = ctx.from.id;
        
        if (!userData[userId]) {
            await sendMessage(ctx, messageTemplates.error('Anda belum memiliki data OTP untuk dihapus.'), unverifiedMenu);
            return;
        }

        // Hapus data OTP dan verifikasi
        delete userData[userId].phoneNumber;
        delete userData[userId].verified;
        delete userData[userId].accessToken;
        delete userData[userId].otpData;
        saveUser Data(userData);

        await sendMessage(ctx, `
╭─〔 OTP DIHAPUS 〕──────────╮
│ ✅ Data OTP berhasil dihapus
│
├─〔 PETUNJUK 〕─────────────
│ 1. Klik "Minta OTP"
│ 2. Masukkan nomor baru
╰────────────────────────────╯`, unverifiedMenu);
    } catch (error) {
        await sendMessage(ctx, messageTemplates.error('Gagal menghapus data OTP. Silakan coba lagi.'), unverifiedMenu);
    }
});

bot.catch((err, ctx) => {
    console.error('Error:', err);
    ctx.reply(messageTemplates.error('Terjadi kesalahan. Silakan coba lagi nanti.'), unverifiedMenu);
});

bot.launch()
    .then(() => {
        console.log('Bot started successfully');
    })
    .catch((err) => {
        console.error('Failed to start bot:', err);
    });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
