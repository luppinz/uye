const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// Konfigurasi logging
const LOG_FILE = path.join(__dirname, 'bot.log');

function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message} ${Object.keys(data).length ? JSON.stringify(data, null, 2) : ''}`;
    const colors = {
        DEBUG: '\x1b[36m',
        INFO: '\x1b[32m', 
        WARN: '\x1b[33m',
        ERROR: '\x1b[31m'
    };
    console.log(`${colors[level]}${logMessage}\x1b[0m`);
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

// Konfigurasi API
const DOR_CONFIG = {
    apiUrl: 'https://golang-openapi-packagepurchase-xltembakservice.kmsp-store.com/v1',
    apiKey: 'fe53906b-a4a4-4ce0-bdbd-a80dfaa003db',
    packageCode: 'XLUNLITURBOPREMIUMPROMO3K', // Default package
    paymentMethod: 'BALANCE' // Default payment method: 'DANA', 'QRIS', atau 'BALANCE'
};

const OTP_CONFIG = {
    requestUrl: 'https://golang-openapi-reqotp-xltembakservice.kmsp-store.com/v1',
    verifyUrl: 'https://golang-openapi-login-xltembakservice.kmsp-store.com/v1',
    apiKey: 'fe53906b-a4a4-4ce0-bdbd-a80dfaa003db'
};

// Tambahkan konfigurasi API untuk balance check
const BALANCE_CONFIG = {
    apiUrl: 'https://golang-openapi-panelaccountbalance-xltembakservice.kmsp-store.com/v1',
    apiKey: 'fe53906b-a4a4-4ce0-bdbd-a80dfaa003db'
};

// Tambahkan konfigurasi API untuk quota details
const QUOTA_CONFIG = {
    apiUrl: 'https://golang-openapi-quotadetails-xltembakservice.kmsp-store.com/v1',
    apiKey: 'fe53906b-a4a4-4ce0-bdbd-a80dfaa003db'
};

// Ganti dengan token bot Telegram Anda dari @BotFather
const TELEGRAM_TOKEN = '7585136076:AAHCMVn8iYGHDTNRdcnk9tznO-Y_O46BfYo';

// Inisialisasi bot Telegram
const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});

// File untuk menyimpan data OTP
const OTP_DATA_FILE = path.join(__dirname, 'otp_data.json');

// Fungsi untuk mengelola data OTP
function loadOtpData() {
    try {
        if (fs.existsSync(OTP_DATA_FILE)) {
            const data = fs.readFileSync(OTP_DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
        return {};
    } catch (error) {
        log('ERROR', 'Failed to load OTP data', { error: error.message });
        return {};
    }
}

function saveOtpData(data) {
    try {
        fs.writeFileSync(OTP_DATA_FILE, JSON.stringify(data, null, 2));
        log('DEBUG', 'OTP data saved successfully');
    } catch (error) {
        log('ERROR', 'Failed to save OTP data', { error: error.message });
        throw error;
    }
}

function updateUserOtpData(chatId, data) {
    try {
        const otpData = loadOtpData();
        otpData[chatId] = {
            ...data,
            timestamp: Date.now(),
            updated_at: new Date().toISOString()
        };
        saveOtpData(otpData);
        log('INFO', 'User OTP data updated', { chatId, status: data.status });
    } catch (error) {
        log('ERROR', 'Failed to update user OTP data', { chatId, error: error.message });
        throw error;
    }
}

function getUserOtpData(chatId) {
    try {
        const otpData = loadOtpData();
        return otpData[chatId];
    } catch (error) {
        log('ERROR', 'Failed to get user OTP data', { chatId, error: error.message });
        return null;
    }
}

function deleteUserOtpData(chatId) {
    try {
        const otpData = loadOtpData();
        if (otpData[chatId]) {
            delete otpData[chatId];
            saveOtpData(otpData);
            log('INFO', 'User OTP data deleted', { chatId });
        }
    } catch (error) {
        log('ERROR', 'Failed to delete user OTP data', { chatId, error: error.message });
        throw error;
    }
}

// Fungsi untuk mengambil saldo akun panel
async function getAccountBalance() {
    try {
        log('DEBUG', 'Fetching account balance from API');
        
        const balanceUrl = `${BALANCE_CONFIG.apiUrl}?api_key=${BALANCE_CONFIG.apiKey}`;
        
        const response = await axios.get(balanceUrl, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        log('INFO', 'Account balance fetched successfully', {
            status: response.data.status,
            statusCode: response.data.statusCode,
            balance: response.data.data?.balance
        });

        return response.data;
    } catch (error) {
        log('ERROR', 'Failed to fetch account balance', {
            error: error.message,
            response: error.response?.data
        });
        throw error;
    }
}

// Fungsi untuk mengambil detail kuota aktif
async function getQuotaDetails(accessToken) {
    try {
        log('DEBUG', 'Fetching quota details from API');
        
        const quotaUrl = `${QUOTA_CONFIG.apiUrl}?api_key=${QUOTA_CONFIG.apiKey}&access_token=${accessToken}`;
        
        const response = await axios.get(quotaUrl, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        log('INFO', 'Quota details fetched successfully', {
            status: response.data.status,
            statusCode: response.data.statusCode,
            msisdn: response.data.data?.msisdn,
            totalQuotas: response.data.data?.quotas?.length || 0
        });

        return response.data;
    } catch (error) {
        log('ERROR', 'Failed to fetch quota details', {
            error: error.message,
            response: error.response?.data
        });
        throw error;
    }
}

// Fungsi untuk format saldo dalam Rupiah
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

// Fungsi untuk format informasi kuota
function formatQuotaInfo(quota) {
    let info = `📦 **${quota.name}**\n`;
    info += `⏰ Expired: ${quota.expired_at}\n`;
    
    if (quota.benefits && quota.benefits.length > 0) {
        info += `📊 **Benefits:**\n`;
        quota.benefits.forEach((benefit, index) => {
            info += `   ${index + 1}. ${benefit.name}\n`;
            if (benefit.quota && benefit.remaining_quota) {
                info += `      💾 Kuota: ${benefit.quota} | Sisa: ${benefit.remaining_quota}\n`;
            }
            if (benefit.information) {
                info += `      ℹ️ Info: ${benefit.information}\n`;
            }
        });
    }
    
    return info;
}

// Fungsi API
async function processDorRequest(phone, accessToken, packageCode = DOR_CONFIG.packageCode, paymentMethod = DOR_CONFIG.paymentMethod) {
    try {
        log('DEBUG', 'Processing DOR request with new API', {
            phone,
            packageCode,
            paymentMethod,
            accessToken: accessToken.substring(0, 10) + '...'
        });

        // Konstruksi URL dengan parameter baru
        const dorUrl = `${DOR_CONFIG.apiUrl}?api_key=${DOR_CONFIG.apiKey}&package_code=${packageCode}&phone=${phone}&access_token=${accessToken}&payment_method=${paymentMethod}`;
        
        const response = await axios.get(dorUrl, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        log('INFO', 'DOR request processed with new API', {
            phone,
            status: response.data.status,
            statusCode: response.data.statusCode,
            trxId: response.data.data?.trx_id,
            hasDeeplink: response.data.data?.have_deeplink,
            isQris: response.data.data?.is_qris
        });

        return response.data;
    } catch (error) {
        log('ERROR', 'Failed to process DOR request with new API', {
            error: error.message,
            response: error.response?.data,
            phone,
            packageCode,
            paymentMethod
        });
        throw error;
    }
}

// Command handlers
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const menuText = `
🔥 *XL DOR BOT TELEGRAM*

Selamat datang! Bot ini membantu Anda untuk melakukan DOR XL dengan API terbaru.

📋 *MENU PERINTAH:*
/mintaotp <nomor> - Minta kode OTP
/verifotp <kode> - Verifikasi OTP  
/kuota - Lihat kuota/paket aktif
/saldo - Cek saldo akun panel
/dor - Info paket dan payment
/lanjutdor - Proses pembelian
/setpackage <code> - Ganti package code
/setpayment <method> - Ganti payment method (DANA/QRIS/BALANCE)
/status - Cek status login
/logout - Logout dan hapus data
/menu - Tampilkan menu ini

⚠️ *PERHATIAN:*
• Nomor target harus pelanggan XL aktif
• Sesi login berlaku 1 jam
• OTP berlaku 5 menit
• Metode BALANCE menggunakan saldo panel

📦 *Package saat ini:* ${DOR_CONFIG.packageCode}
💳 *Payment method:* ${DOR_CONFIG.paymentMethod}
    `;
    
    bot.sendMessage(chatId, menuText, {parse_mode: 'Markdown'});
    log('INFO', 'New user started bot', { chatId, username: msg.from.username });
});

bot.onText(/\/menu/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
📋 *CARA PENGGUNAAN:*

1️⃣ /saldo
   Cek saldo akun panel Anda

2️⃣ /kuota
   Lihat kuota/paket yang aktif saat ini

3️⃣ /mintaotp <nomor_hp>
   Contoh: /mintaotp 087777334618

4️⃣ /verifotp <kode_otp>  
   Contoh: /verifotp 123456

5️⃣ /setpackage <code>
   Contoh: /setpackage XLUNLITURBOSUPERXCPROMO15K_PL

6️⃣ /setpayment <method>
   Contoh: /setpayment BALANCE

7️⃣ /dor
   Untuk info paket dan payment

8️⃣ /lanjutdor
   Untuk memulai proses pembelian

💡 *Tips:* 
• Gunakan /saldo untuk mengecek saldo panel
• Gunakan /kuota untuk melihat paket aktif
• Pastikan saldo mencukupi sebelum transaksi!
    `, {parse_mode: 'Markdown'});
});

// Command untuk cek saldo akun panel
bot.onText(/\/saldo/, async (msg) => {
    const chatId = msg.chat.id;
    const statusMsg = await bot.sendMessage(chatId, "⏳ Mengecek saldo akun panel...");
    
    try {
        const balanceResponse = await getAccountBalance();
        
        if (balanceResponse.status === true && balanceResponse.statusCode === 200) {
            const balance = balanceResponse.data.balance;
            const formattedBalance = formatCurrency(balance);
            
            const balanceText = `💰 **SALDO AKUN PANEL**\n\n` +
                              `💳 Saldo Tersedia: **${formattedBalance}**\n` +
                              `🔢 Nominal: ${balance.toLocaleString('id-ID')}\n` +
                              `✅ Status: Aktif\n` +
                              `📅 Dicek pada: ${new Date().toLocaleString('id-ID', {
                                  timeZone: 'Asia/Jakarta',
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit'
                              })} WIB\n\n` +
                              `💡 **Tips:**\n` +
                              `• Gunakan /setpayment BALANCE untuk menggunakan saldo panel\n` +
                              `• Pastikan saldo mencukupi sebelum transaksi\n` +
                              `• Saldo akan terpotong otomatis saat menggunakan metode BALANCE`;
            
            bot.editMessageText(balanceText, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
            });
            
            log('INFO', 'Account balance displayed successfully', {
                chatId,
                balance,
                formattedBalance
            });
            
        } else {
            throw new Error(balanceResponse.message || "Gagal mengambil saldo akun");
        }
        
    } catch (error) {
        log('ERROR', 'Failed to display account balance', {
            error: error.message,
            response: error.response?.data,
            chatId
        });
        
        let errorMessage = "Gagal mengecek saldo akun panel";
        if (error.response?.data?.message) {
            errorMessage = error.response.data.message;
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        bot.editMessageText(`❌ ${errorMessage}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id
        });
    }
});

// Alias command untuk cek saldo
bot.onText(/\/balance/, async (msg) => {
    bot.emit('text', Object.assign({}, msg, { text: '/saldo' }));
});

bot.onText(/\/ceksaldo/, async (msg) => {
    bot.emit('text', Object.assign({}, msg, { text: '/saldo' }));
});

// Command untuk melihat kuota/paket aktif
bot.onText(/\/kuota/, async (msg) => {
    const chatId = msg.chat.id;
    const userData = getUserOtpData(chatId);

    if (!userData || userData.status !== 'logged_in' || !userData.access_token) {
        bot.sendMessage(chatId, 
            "⚠️ Anda belum login!\n\n" +
            "Silakan login terlebih dahulu dengan:\n" +
            "1. /mintaotp <nomor>\n" +
            "2. /verifotp <kode>"
        );
        return;
    }

    const statusMsg = await bot.sendMessage(chatId, "⏳ Mengambil data kuota aktif...");
    
    try {
        const quotaResponse = await getQuotaDetails(userData.access_token);
        
        if (quotaResponse.status === true && quotaResponse.statusCode === 200) {
            const { data } = quotaResponse;
            
            if (!data.quotas || data.quotas.length === 0) {
                bot.editMessageText(
                    `📱 **KUOTA AKTIF**\n\n` +
                    `📞 Nomor: ${data.msisdn}\n` +
                    `❌ Tidak ada paket/kuota yang aktif saat ini\n\n` +
                    `💡 Gunakan /dor untuk membeli paket baru`,
                    {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        parse_mode: 'Markdown'
                    }
                );
                return;
            }
            
            // Bagi kuota menjadi beberapa pesan jika terlalu panjang
            const quotasPerMessage = 3;
            const totalPages = Math.ceil(data.quotas.length / quotasPerMessage);
            
            for (let page = 0; page < totalPages; page++) {
                const startIndex = page * quotasPerMessage;
                const endIndex = Math.min(startIndex + quotasPerMessage, data.quotas.length);
                const pageQuotas = data.quotas.slice(startIndex, endIndex);
                
                let messageText = `📱 **KUOTA AKTIF** (${page + 1}/${totalPages})\n\n`;
                messageText += `📞 Nomor: ${data.msisdn}\n`;
                messageText += `📝 ${data.text}\n\n`;
                
                pageQuotas.forEach((quota, index) => {
                    messageText += formatQuotaInfo(quota);
                    if (index < pageQuotas.length - 1) {
                        messageText += '\n' + '─'.repeat(30) + '\n\n';
                    }
                });
                
                messageText += `\n💡 **Tips:**\n`;
                messageText += `• /kuota - Refresh data kuota\n`;
                messageText += `• /dor - Beli paket baru\n`;
                messageText += `• /status - Cek status login`;
                
                if (page === 0) {
                    // Edit pesan pertama
                    bot.editMessageText(messageText, {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        parse_mode: 'Markdown'
                    });
                } else {
                    // Kirim pesan baru untuk halaman selanjutnya
                    bot.sendMessage(chatId, messageText, {
                        parse_mode: 'Markdown'
                    });
                }
                
                // Delay antar pesan untuk menghindari rate limit
                if (page < totalPages - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            log('INFO', 'Quota details displayed successfully', {
                chatId,
                msisdn: data.msisdn,
                totalQuotas: data.quotas.length,
                totalPages
            });
            
        } else {
            throw new Error(quotaResponse.message || "Gagal mengambil data kuota");
        }
        
    } catch (error) {
        log('ERROR', 'Failed to display quota details', {
            error: error.message,
            response: error.response?.data,
            chatId
        });
        
        let errorMessage = "Gagal mengambil data kuota aktif";
        if (error.response?.data?.message) {
            errorMessage = error.response.data.message;
        } else if (error.message.includes('access_token')) {
            errorMessage = "Access token tidak valid, silakan login ulang";
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        bot.editMessageText(`❌ ${errorMessage}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id
        });
    }
});

// Alias command untuk kuota
bot.onText(/\/paketaktif/, async (msg) => {
    bot.emit('text', Object.assign({}, msg, { text: '/kuota' }));
});

bot.onText(/\/cekquota/, async (msg) => {
    bot.emit('text', Object.assign({}, msg, { text: '/kuota' }));
});

bot.onText(/\/mintaotp (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const nomor_hp = match[1].trim();
    
    log('DEBUG', 'Received mintaotp command', { chatId, targetNumber: nomor_hp });
    
    if (!nomor_hp) {
        bot.sendMessage(chatId, "⚠️ Format: /mintaotp <nomor_hp>\nContoh: /mintaotp 087777334618");
        return;
    }

    const statusMsg = await bot.sendMessage(chatId, "⏳ Meminta OTP...");
    
    try {
        log('INFO', 'Making OTP request', { targetNumber: nomor_hp });
        
        // Konstruksi URL dengan query parameters
        const otpUrl = `${OTP_CONFIG.requestUrl}?api_key=${OTP_CONFIG.apiKey}&phone=${nomor_hp}&method=OTP`;
        
        const response = await axios.get(otpUrl, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Handle response dengan struktur baru
        if (response.data.status === true && response.data.statusCode === 200) {
            const { data } = response.data;
            const expires_in = data.can_resend_in || 300; // Default 5 menit jika tidak ada
            
            updateUserOtpData(chatId, {
                nomor_hp: nomor_hp,
                auth_id: data.auth_id, // Simpan auth_id dari response
                expires_in: expires_in,
                can_resend_in: data.can_resend_in,
                status: 'waiting_verification',
                expires_at: Date.now() + (expires_in * 1000)
            });

            log('INFO', 'OTP request successful', {
                chatId,
                targetNumber: nomor_hp,
                authId: data.auth_id,
                canResendIn: data.can_resend_in
            });

            bot.editMessageText(
                "✅ OTP berhasil dikirim!\n\n" +
                "📱 Silakan cek SMS Anda untuk mendapatkan kode OTP\n" +
                "Ketik /verifotp <kode> untuk verifikasi\n" +
                `⏰ Kode berlaku ${Math.floor(expires_in / 60)} menit\n` +
                `🔄 Dapat mengirim ulang dalam ${data.can_resend_in} detik`,
                {
                    chat_id: chatId,
                    message_id: statusMsg.message_id
                }
            );

            // Auto delete expired OTP data
            setTimeout(() => {
                const currentData = getUserOtpData(chatId);
                if (currentData && currentData.status === 'waiting_verification') {
                    log('INFO', 'OTP expired', { chatId });
                    deleteUserOtpData(chatId);
                }
            }, expires_in * 1000);
            
        } else {
            throw new Error(response.data.message || "Gagal meminta OTP");
        }
        
    } catch (error) {
        log('ERROR', 'OTP request failed', {
            error: error.message,
            response: error.response?.data,
            nomor_hp
        });
        
        // Handle specific error messages dari API
        let errorMessage = "Gagal meminta OTP";
        if (error.response?.data?.message) {
            errorMessage = error.response.data.message;
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        bot.editMessageText(`❌ ${errorMessage}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id
        });
    }
});

bot.onText(/\/verifotp (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const kode_otp = match[1].trim();
    const userData = getUserOtpData(chatId);

    log('DEBUG', 'Received verifotp command', {
        chatId,
        status: userData?.status,
        expiresAt: userData?.expires_at,
        authId: userData?.auth_id
    });

    if (!userData) {
        log('WARN', 'User not found or no OTP data', { chatId });
        bot.sendMessage(chatId, "⚠️ Silakan ketik /mintaotp <nomor> terlebih dahulu!");
        return;
    }

    if (userData.expires_at && Date.now() > userData.expires_at) {
        log('WARN', 'OTP expired', { chatId });
        deleteUserOtpData(chatId);
        bot.sendMessage(chatId, "⚠️ OTP sudah expired. Silakan minta OTP baru dengan /mintaotp");
        return;
    }

    if (userData.status !== 'waiting_verification') {
        log('WARN', 'Invalid OTP status', { chatId, status: userData.status });
        bot.sendMessage(chatId, "⚠️ OTP sudah tidak valid. Silakan minta OTP baru dengan /mintaotp");
        return;
    }

    // Validasi auth_id ada
    if (!userData.auth_id) {
        log('ERROR', 'Missing auth_id in user data', { chatId });
        bot.sendMessage(chatId, "⚠️ Data OTP tidak lengkap. Silakan minta OTP baru dengan /mintaotp");
        return;
    }

    const statusMsg = await bot.sendMessage(chatId, "⏳ Memverifikasi OTP...");
    
    try {
        const { nomor_hp, auth_id } = userData;
        log('INFO', 'Verifying OTP with new API', {
            chatId,
            targetNumber: nomor_hp,
            authId: auth_id,
            otpCode: kode_otp
        });

        // Konstruksi URL dengan parameter baru
        const verifyUrl = `${OTP_CONFIG.verifyUrl}?api_key=${OTP_CONFIG.apiKey}&phone=${nomor_hp}&method=OTP&auth_id=${auth_id}&otp=${kode_otp}`;
        
        const response = await axios.get(verifyUrl, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Handle response dengan struktur baru
        if (response.data.status === true && response.data.statusCode === 200) {
            const { data } = response.data;
            const login_expires_in = 3600; // Default 1 jam karena tidak ada expires_in dari API baru

            updateUserOtpData(chatId, {
                ...userData,
                access_token: data.access_token,
                status: 'logged_in',
                expires_at: Date.now() + (login_expires_in * 1000),
                verified_at: new Date().toISOString()
            });

            log('INFO', 'OTP verification successful with new API', {
                chatId,
                accessToken: data.access_token.substring(0, 10) + '...', // Log partial token untuk security
                expiresIn: login_expires_in
            });

            bot.editMessageText(
                "✅ Verifikasi OTP berhasil!\n\n" +
                "📱 Anda sudah login ke sistem XL\n" +
                "Ketik /dor untuk melanjutkan pembelian\n" +
                `⏰ Sesi login berlaku ${Math.floor(login_expires_in / 60)} menit\n` +
                `🔑 Token: ${data.access_token.substring(0, 15)}...`,
                {
                    chat_id: chatId,
                    message_id: statusMsg.message_id
                }
            );

            // Auto logout after expiration
            setTimeout(() => {
                const currentData = getUserOtpData(chatId);
                if (currentData && currentData.status === 'logged_in') {
                    log('INFO', 'Login session expired', { chatId });
                    deleteUserOtpData(chatId);
                }
            }, login_expires_in * 1000);
            
        } else {
            throw new Error(response.data.message || "Gagal verifikasi OTP");
        }
        
    } catch (error) {
        log('ERROR', 'OTP verification failed with new API', {
            error: error.message,
            response: error.response?.data,
            chatId,
            kode_otp,
            auth_id: userData.auth_id
        });
        
        // Handle specific error messages dari API
        let errorMessage = "Gagal verifikasi OTP";
        if (error.response?.data?.message) {
            errorMessage = error.response.data.message;
        } else if (error.message.includes('auth_id')) {
            errorMessage = "Auth ID tidak valid, silakan minta OTP baru";
        } else if (error.message.includes('otp')) {
            errorMessage = "Kode OTP salah atau expired";
        } else {
            errorMessage = error.message;
        }
        
        bot.editMessageText(`❌ ${errorMessage}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id
        });
    }
});

bot.onText(/\/dor/, async (msg) => {
    const chatId = msg.chat.id;
    const userData = getUserOtpData(chatId);

    if (!userData || userData.status !== 'logged_in') {
        bot.sendMessage(chatId, 
            "⚠️ Anda belum login!\n\n" +
            "Silakan login terlebih dahulu dengan:\n" +
            "1. /mintaotp <nomor>\n" +
            "2. /verifotp <kode>"
        );
        return;
    }

    // Inline keyboard untuk konfirmasi
    const keyboard = {
        inline_keyboard: [
            [
                { text: "✅ Lanjutkan Pembelian", callback_data: "confirm_dor" },
                { text: "❌ Batal", callback_data: "cancel_dor" }
            ]
        ]
    };

    bot.sendMessage(chatId,
        "⚠️ *INFORMASI PEMBELIAN PAKET* ⚠️\n\n" +
        `📦 *Paket yang akan dibeli:*\n` +
        `${DOR_CONFIG.packageCode}\n\n` +
        `💳 *Metode Pembayaran:*\n` +
        `${DOR_CONFIG.paymentMethod}\n\n` +
        "📱 *Perhatian:*\n" +
        "• Pastikan nomor target dapat menerima paket\n" +
        "• Pastikan aplikasi DANA aktif (jika menggunakan DANA)\n" +
        "• QR Code berlaku terbatas (jika menggunakan QRIS)\n" +
        "• Saldo panel akan terpotong (jika menggunakan BALANCE)\n\n" +
        "Klik tombol di bawah untuk melanjutkan atau batalkan",
        {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        }
    );
});

bot.onText(/\/lanjutdor/, async (msg) => {
    const chatId = msg.chat.id;
    await processDorTransaction(chatId);
});

// Callback query handler untuk inline buttons
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    if (data === 'confirm_dor') {
        await processDorTransaction(chatId, callbackQuery.message.message_id);
    } else if (data === 'cancel_dor') {
        bot.editMessageText(
            "❌ Transaksi dibatalkan",
            {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            }
        );
    }
    
    bot.answerCallbackQuery(callbackQuery.id);
});

async function processDorTransaction(chatId, messageId = null) {
    const userData = getUserOtpData(chatId);
    
    if (!userData || userData.status !== 'logged_in' || !userData.access_token) {
        bot.sendMessage(chatId, "⚠️ Sesi login expired atau tidak valid. Silakan login ulang dengan /mintaotp dan /verifotp!");
        return;
    }

    const { nomor_hp, access_token } = userData;
    
    let statusMsg;
    if (messageId) {
        bot.editMessageText("⏳ Mengecek saldo dan memproses pembelian...", {
            chat_id: chatId,
            message_id: messageId
        });
    } else {
        statusMsg = await bot.sendMessage(chatId, "⏳ Mengecek saldo dan memproses pembelian...");
        messageId = statusMsg.message_id;
    }
    
    try {
        // Cek saldo terlebih dahulu jika menggunakan metode BALANCE
        if (DOR_CONFIG.paymentMethod === 'BALANCE') {
            try {
                const balanceResponse = await getAccountBalance();
                if (balanceResponse.status === true) {
                    const balance = balanceResponse.data.balance;
                    log('INFO', 'Current account balance before transaction', {
                        chatId,
                        balance,
                        formattedBalance: formatCurrency(balance)
                    });
                    
                    // Update status message dengan info saldo
                    bot.editMessageText(`⏳ Saldo: ${formatCurrency(balance)} - Memproses pembelian...`, {
                        chat_id: chatId,
                        message_id: messageId
                    });
                    
                    // Validasi saldo minimum (opsional)
                    if (balance < 1000) {
                        throw new Error("Saldo tidak mencukupi untuk melakukan transaksi");
                    }
                }
            } catch (balanceError) {
                log('ERROR', 'Failed to check balance before transaction', {
                    error: balanceError.message,
                    chatId
                });
                
                if (balanceError.message.includes('Saldo tidak mencukupi')) {
                    bot.editMessageText(`❌ ${balanceError.message}`, {
                        chat_id: chatId,
                        message_id: messageId
                    });
                    return;
                }
                // Lanjutkan transaksi meskipun gagal cek saldo untuk alasan lain
            }
        }
        
        log('INFO', 'Starting DOR process with new API', {
            chatId,
            nomor_hp,
            packageCode: DOR_CONFIG.packageCode,
            paymentMethod: DOR_CONFIG.paymentMethod
        });

        const dorResponse = await processDorRequest(nomor_hp, access_token, DOR_CONFIG.packageCode, DOR_CONFIG.paymentMethod);
        
        if (dorResponse.status === true && dorResponse.statusCode === 200) {
            const { data } = dorResponse;
            
            // Handle DANA Deeplink
            if (data.have_deeplink && data.deeplink_data?.deeplink_url) {
                bot.editMessageText(
                    `✅ ${dorResponse.message}\n\n` +
                    `📦 *Detail Pembelian:*\n` +
                    `📱 Nomor: ${data.msisdn}\n` +
                    `📋 Paket: ${data.package_name}\n` +
                    `💰 Fee: Rp ${data.package_processing_fee}\n` +
                    `🔖 ID Transaksi: ${data.trx_id}\n` +
                    `💳 Metode: ${data.deeplink_data.payment_method}\n\n` +
                    `🔗 *Link Pembayaran DANA:*\n` +
                    `${data.deeplink_data.deeplink_url}\n\n` +
                    `⏰ Segera lakukan pembayaran melalui aplikasi DANA!`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown'
                    }
                );
                
                log('INFO', 'DOR with DANA deeplink completed', {
                    chatId,
                    trxId: data.trx_id,
                    paymentMethod: data.deeplink_data.payment_method
                });
            }
            // Handle QRIS
            else if (data.is_qris && data.qris_data?.qr_code) {
                const qrBuffer = await QRCode.toBuffer(data.qris_data.qr_code);
                const remainingMinutes = Math.floor(data.qris_data.remaining_time / 60);
                const remainingSeconds = data.qris_data.remaining_time % 60;
                
                bot.editMessageText("✅ QR Code pembayaran berhasil dibuat!", {
                    chat_id: chatId,
                    message_id: messageId
                });
                
                bot.sendPhoto(chatId, qrBuffer, {
                    caption: `${dorResponse.message}\n\n` +
                            `📦 *Detail Pembelian:*\n` +
                            `📱 Nomor: ${data.msisdn}\n` +
                            `📋 Paket: ${data.package_name}\n` +
                            `💰 Fee: Rp ${data.package_processing_fee}\n` +
                            `🔖 ID Transaksi: ${data.trx_id}\n` +
                            `💳 Metode: QRIS\n\n` +
                            `⏰ Waktu pembayaran: ${remainingMinutes} menit ${remainingSeconds} detik\n` +
                            `📅 Expired pada: ${new Date(data.qris_data.payment_expired_at * 1000).toLocaleString('id-ID')}\n\n` +
                            `Scan QR Code di atas dengan E-Wallet atau Mobile Banking Anda!`,
                    parse_mode: 'Markdown'
                });
                
                log('INFO', 'DOR with QRIS completed', {
                    chatId,
                    trxId: data.trx_id,
                    remainingTime: data.qris_data.remaining_time
                });
            }
            // Handle response untuk metode BALANCE (direct success)
            else {
                let successMessage = `✅ ${dorResponse.message}\n\n` +
                    `📦 *Detail Pembelian:*\n` +
                    `📱 Nomor: ${data.msisdn}\n` +
                    `📋 Paket: ${data.package_name}\n` +
                    `💰 Fee: Rp ${data.package_processing_fee}\n` +
                    `🔖 ID Transaksi: ${data.trx_id}\n`;
                
                // Tambahkan info khusus untuk metode BALANCE
                if (DOR_CONFIG.paymentMethod === 'BALANCE') {
                    successMessage += `💳 Metode: BALANCE (Saldo Panel)\n\n` +
                        `✅ Pembayaran berhasil menggunakan saldo panel!\n` +
                        `💡 Gunakan /saldo untuk mengecek sisa saldo terbaru`;
                } else {
                    successMessage += `\n✅ Transaksi berhasil diproses!`;
                }
                
                bot.editMessageText(successMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
                
                log('INFO', 'DOR direct success completed', {
                    chatId,
                    trxId: data.trx_id,
                    paymentMethod: DOR_CONFIG.paymentMethod
                });
            }
            
            // Clean up user data setelah berhasil
            deleteUserOtpData(chatId);
            
        } else {
            throw new Error(dorResponse.message || "Gagal memproses pembelian paket");
        }
        
    } catch (error) {
        log('ERROR', 'DOR process failed with new API', {
            error: error.message,
            response: error.response?.data,
            chatId,
            nomor_hp
        });
        
        let errorMessage = "Gagal memproses pembelian";
        if (error.response?.data?.message) {
            errorMessage = error.response.data.message;
        } else if (error.message.includes('access_token')) {
            errorMessage = "Access token tidak valid, silakan login ulang";
        } else if (error.message.includes('saldo')) {
            errorMessage = "Saldo tidak mencukupi untuk transaksi ini";
        } else {
            errorMessage = error.message;
        }
        
        bot.editMessageText(`❌ ${errorMessage}`, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

bot.onText(/\/setpackage (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const packageCode = match[1].trim();
    
    if (!packageCode) {
        bot.sendMessage(chatId, 
            "⚠️ Format: /setpackage <package_code>\n" +
            "Contoh: /setpackage XL_EDU_2GB_1K_DANA"
        );
        return;
    }
    
    DOR_CONFIG.packageCode = packageCode;
    bot.sendMessage(chatId, `✅ Package code diubah menjadi: ${packageCode}`);
    log('INFO', 'Package code changed', { chatId, newPackageCode: packageCode });
});

bot.onText(/\/setpayment (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const paymentMethod = match[1].trim().toUpperCase();
    
    if (!paymentMethod || !['DANA', 'QRIS', 'BALANCE'].includes(paymentMethod)) {
        bot.sendMessage(chatId, 
            "⚠️ Format: /setpayment <method>\n" +
            "Pilihan: DANA, QRIS, atau BALANCE\n" +
            "Contoh: /setpayment BALANCE"
        );
        return;
    }
    
    DOR_CONFIG.paymentMethod = paymentMethod;
    bot.sendMessage(chatId, `✅ Payment method diubah menjadi: ${paymentMethod}`);
    log('INFO', 'Payment method changed', { chatId, newPaymentMethod: paymentMethod });
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const userData = getUserOtpData(chatId);
    
    if (!userData) {
        bot.sendMessage(chatId, "📊 *Status:* Belum login", {parse_mode: 'Markdown'});
        return;
    }
    
    const remainingTime = userData.expires_at ? Math.max(0, Math.floor((userData.expires_at - Date.now()) / 1000)) : 0;
    const minutes = Math.floor(remainingTime / 60);
    const seconds = remainingTime % 60;
    
    bot.sendMessage(chatId,
        `📊 *STATUS AKUN*\n\n` +
        `👤 User ID: ${chatId}\n` +
        `📱 Target: ${userData.nomor_hp || 'N/A'}\n` +
        `📊 Status: ${userData.status || 'Unknown'}\n` +
        `⏰ Sisa waktu: ${minutes}m ${seconds}s\n` +
        `📦 Package: ${DOR_CONFIG.packageCode}\n` +
        `💳 Payment: ${DOR_CONFIG.paymentMethod}\n` +
        `🔑 Token: ${userData.access_token ? userData.access_token.substring(0, 15) + '...' : 'N/A'}`,
        {parse_mode: 'Markdown'}
    );
});

bot.onText(/\/logout/, async (msg) => {
    const chatId = msg.chat.id;
    const userData = getUserOtpData(chatId);
    
    if (!userData) {
        bot.sendMessage(chatId, "⚠️ Anda belum login.");
        return;
    }
    
    deleteUserOtpData(chatId);
    bot.sendMessage(chatId, "✅ Logout berhasil! Data sesi telah dihapus.");
    log('INFO', 'User logged out', { chatId });
});

// Error handling
bot.on('polling_error', (error) => {
    log('ERROR', 'Polling error', { error: error.message });
});

// Cleanup function untuk data expired
setInterval(() => {
    try {
        const otpData = loadOtpData();
        const now = Date.now();
        let hasChanges = false;
        
        for (const [chatId, userData] of Object.entries(otpData)) {
            if (userData.expires_at && now > userData.expires_at) {
                delete otpData[chatId];
                hasChanges = true;
                log('INFO', 'Expired data cleaned up', { chatId });
            }
        }
        
        if (hasChanges) {
            saveOtpData(otpData);
        }
    } catch (error) {
        log('ERROR', 'Cleanup process failed', { error: error.message });
    }
}, 60000); // Cleanup setiap 1 menit

// Start bot
log('INFO', 'Telegram bot started successfully');
console.log('🚀 Bot Telegram XL DOR sedang berjalan...');
console.log('📱 Bot siap menerima perintah!');

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Bot shutting down gracefully...');
    console.log('\n👋 Bot dihentikan. Terima kasih!');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    log('ERROR', 'Uncaught exception', { error: error.message, stack: error.stack });
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    log('ERROR', 'Unhandled rejection', { reason, promise });
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = bot;
