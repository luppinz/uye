const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ===============================
// KONFIGURASI BOT
// ===============================

// Token bot Telegram (ganti dengan token bot Anda)
const BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE';

// Konfigurasi admin
const ADMIN_CONFIG = {
    adminIds: [5649339918, 5649339918], // Ganti dengan Telegram ID admin yang valid
    superAdminId: 5649339918, // Super admin yang bisa menambah admin lain
};

// Konfigurasi DOR
const DOR_CONFIG = {
    packageCode: 'XL_EDU_2GB_1K_DANA', // Default package
    autoPayment: true, // Otomatis gunakan balance
    minBalance: 5000 // Minimum balance required (dalam rupiah)
};

// Konfigurasi API XL
const XL_API_CONFIG = {
    baseUrl: 'https://golang-openapi-xltembakservice.kmsp-store.com',
    apiKey: 'fe53906b-a4a4-4ce0-bdbd-a80dfaa003db'
};

// Konfigurasi API Package List
const PACKAGE_API_CONFIG = {
    baseUrl: 'https://golang-openapi-packagelist-xltembakservice.kmsp-store.com/v1',
    apiKey: 'fe53906b-a4a4-4ce0-bdbd-a80dfaa003db',
    timeout: 15000
};

// Konfigurasi balance
const BALANCE_CONFIG = {
    defaultBalance: 0,
    topupMethods: ['DANA', 'QRIS', 'MANUAL'] // Method untuk top up balance
};

// Cache untuk package list (refresh setiap 30 menit)
let packageListCache = {
    data: null,
    lastFetch: null,
    ttl: 30 * 60 * 1000 // 30 menit
};

// ===============================
// INISIALISASI BOT
// ===============================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 XL DOR Bot started successfully!');

// ===============================
// FUNGSI HELPER
// ===============================

// Fungsi logging
function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        message,
        data
    };
    
    console.log(`[${timestamp}] ${level}: ${message}`, data);
    
    // Simpan ke file log
    try {
        let logs = [];
        try {
            const logData = fs.readFileSync('bot_logs.json', 'utf8');
            logs = JSON.parse(logData);
        } catch (error) {
            // File belum ada
        }
        
        logs.unshift(logEntry);
        
        // Batasi log hanya 1000 entry terakhir
        if (logs.length > 1000) {
            logs = logs.slice(0, 1000);
        }
        
        fs.writeFileSync('bot_logs.json', JSON.stringify(logs, null, 2));
    } catch (error) {
        console.error('Failed to save log:', error.message);
    }
}

// Fungsi untuk load/save data OTP
function loadOtpData() {
    try {
        const data = fs.readFileSync('otp_data.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

function saveOtpData(data) {
    try {
        fs.writeFileSync('otp_data.json', JSON.stringify(data, null, 2));
    } catch (error) {
        log('ERROR', 'Failed to save OTP data', { error: error.message });
    }
}

function getUserOtpData(chatId) {
    const otpData = loadOtpData();
    return otpData[chatId] || null;
}

// Fungsi admin
function isAdmin(chatId) {
    return ADMIN_CONFIG.adminIds.includes(parseInt(chatId));
}

function isSuperAdmin(chatId) {
    return ADMIN_CONFIG.superAdminId === parseInt(chatId);
}

// ===============================
// FUNGSI BALANCE MANAGEMENT
// ===============================

function getUserBalance(chatId) {
    const otpData = loadOtpData();
    return otpData[chatId]?.balance || 0;
}

function updateUserBalance(chatId, amount, type = 'add') {
    const otpData = loadOtpData();
    if (!otpData[chatId]) {
        otpData[chatId] = { balance: 0 };
    }
    
    if (type === 'add') {
        otpData[chatId].balance = (otpData[chatId].balance || 0) + amount;
    } else if (type === 'subtract') {
        otpData[chatId].balance = Math.max(0, (otpData[chatId].balance || 0) - amount);
    } else if (type === 'set') {
        otpData[chatId].balance = amount;
    }
    
    saveOtpData(otpData);
    return otpData[chatId].balance;
}

function getPackagePrice(packageCode) {
    // Mapping harga paket (dalam rupiah) - akan diupdate dari API
    const packagePrices = {
        'XL_EDU_2GB_1K_DANA': 2000,
        'XL_EDU_5GB_2K_DANA': 3000,
        'XL_COMBO_3GB_15K': 15000,
        'XLUNLITURBOSUPERXCPROMO15K_PL': 3000,
        'XL_COMBO_FLEX_S_30D': 21500,
        'XL_UNLIMITED_DAILY': 5000,
        'XL_UNLIMITED_DAILY_PLUS': 8000,
        'XL_PRIORITY_UNLIMITED': 50000,
        'XL_GAMING_PRO_30D': 35000,
    };
    return packagePrices[packageCode] || 5000; // Default 5000 jika tidak ditemukan
}

// ===============================
// FUNGSI PACKAGE LIST API
// ===============================

async function fetchPackageList(forceRefresh = false) {
    try {
        // Cek cache terlebih dahulu
        if (!forceRefresh && packageListCache.data && 
            packageListCache.lastFetch && 
            (Date.now() - packageListCache.lastFetch) < packageListCache.ttl) {
            log('INFO', 'Using cached package list');
            return packageListCache.data;
        }

        log('INFO', 'Fetching package list from API');
        
        const response = await axios.get(`${PACKAGE_API_CONFIG.baseUrl}?api_key=${PACKAGE_API_CONFIG.apiKey}`, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'XL-DOR-Bot/1.0'
            },
            timeout: PACKAGE_API_CONFIG.timeout
        });

        if (response.data.status === true && response.data.statusCode === 200) {
            // Update cache
            packageListCache.data = response.data.data;
            packageListCache.lastFetch = Date.now();
            
            log('INFO', 'Package list fetched successfully', {
                totalPackages: response.data.data.length
            });
            
            return response.data.data;
        } else {
            throw new Error(response.data.message || 'Failed to fetch package list');
        }

    } catch (error) {
        log('ERROR', 'Failed to fetch package list', {
            error: error.message,
            response: error.response?.data
        });
        
        // Return cached data jika ada error tapi cache masih ada
        if (packageListCache.data) {
            log('WARN', 'Using cached data due to API error');
            return packageListCache.data;
        }
        
        throw error;
    }
}

function formatPackagePrice(packageHargaInt) {
    if (typeof packageHargaInt === 'number') {
        return `Rp ${packageHargaInt.toLocaleString('id-ID')}`;
    }
    return 'Harga tidak tersedia';
}

function truncateText(text, maxLength = 80) {
    if (!text) return 'Tidak ada deskripsi';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// ===============================
// FUNGSI XL API
// ===============================

async function requestOtp(nomorHp) {
    try {
        const response = await axios.post(`${XL_API_CONFIG.baseUrl}/v1/otp/request`, {
            msisdn: nomorHp
        }, {
            headers: {
                'Content-Type': 'application/json',
                'api-key': XL_API_CONFIG.apiKey
            },
            timeout: 10000
        });

        return response.data;
    } catch (error) {
        log('ERROR', 'OTP request failed', {
            error: error.message,
            response: error.response?.data,
            nomorHp
        });
        throw error;
    }
}

async function verifyOtp(authId, otpCode) {
    try {
        const response = await axios.post(`${XL_API_CONFIG.baseUrl}/v1/otp/verify`, {
            auth_id: authId,
            otp_code: otpCode
        }, {
            headers: {
                'Content-Type': 'application/json',
                'api-key': XL_API_CONFIG.apiKey
            },
            timeout: 10000
        });

        return response.data;
    } catch (error) {
        log('ERROR', 'OTP verification failed', {
            error: error.message,
            response: error.response?.data,
            authId
        });
        throw error;
    }
}

async function processDorRequest(nomorHp, accessToken, packageCode, paymentMethod = 'BALANCE') {
    try {
        const response = await axios.post(`${XL_API_CONFIG.baseUrl}/v1/dor`, {
            msisdn: nomorHp,
            package_code: packageCode,
            payment_method: paymentMethod
        }, {
            headers: {
                'Content-Type': 'application/json',
                'api-key': XL_API_CONFIG.apiKey,
                'Authorization': `Bearer ${accessToken}`
            },
            timeout: 30000
        });

        return response.data;
    } catch (error) {
        log('ERROR', 'DOR request failed', {
            error: error.message,
            response: error.response?.data,
            nomorHp,
            packageCode
        });
        throw error;
    }
}

// ===============================
// FUNGSI ADMIN
// ===============================

function saveAdminAction(adminId, action) {
    try {
        let adminLogs = [];
        try {
            const logsData = fs.readFileSync('admin_logs.json', 'utf8');
            adminLogs = JSON.parse(logsData);
        } catch (error) {
            // File belum ada
        }

        adminLogs.unshift({
            admin_id: adminId,
            ...action
        });

        // Batasi log hanya 1000 entry terakhir
        if (adminLogs.length > 1000) {
            adminLogs = adminLogs.slice(0, 1000);
        }

        fs.writeFileSync('admin_logs.json', JSON.stringify(adminLogs, null, 2));
    } catch (error) {
        log('ERROR', 'Failed to save admin action', { error: error.message });
    }
}

function getUserTransactionHistory(userId) {
    try {
        const historyData = fs.readFileSync('transaction_history.json', 'utf8');
        const history = JSON.parse(historyData);
        return history[userId] || [];
    } catch (error) {
        return [];
    }
}

function saveTransactionHistory(chatId, transaction) {
    try {
        let history = {};
        try {
            const historyData = fs.readFileSync('transaction_history.json', 'utf8');
            history = JSON.parse(historyData);
        } catch (error) {
            // File belum ada, buat object kosong
        }
        
        if (!history[chatId]) {
            history[chatId] = [];
        }
        
        history[chatId].unshift(transaction); // Tambah ke awal array
        
        // Batasi riwayat hanya 50 transaksi terakhir per user
        if (history[chatId].length > 50) {
            history[chatId] = history[chatId].slice(0, 50);
        }
        
        fs.writeFileSync('transaction_history.json', JSON.stringify(history, null, 2));
    } catch (error) {
        log('ERROR', 'Failed to save transaction history', { error: error.message });
    }
}

// ===============================
// FUNGSI PACKAGE LIST DISPLAY
// ===============================

async function showPackageListPage(chatId, messageId, packages, page) {
    const itemsPerPage = 8;
    const totalPages = Math.ceil(packages.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentPackages = packages.slice(startIndex, endIndex);
    
    let packageText = `📦 *DAFTAR PAKET XL* (Total: ${packages.length} paket)\n`;
    packageText += `📄 Halaman ${page} dari ${totalPages}\n\n`;
    
    currentPackages.forEach((pkg, index) => {
        const number = startIndex + index + 1;
        packageText += `*${number}. ${pkg.package_name}*\n`;
        packageText += `🔖 Code: \`${pkg.package_code}\`\n`;
        packageText += `💰 Harga: ${formatPackagePrice(pkg.package_harga_int)}\n`;
        packageText += `📝 ${truncateText(pkg.package_description, 60)}\n`;
        
        // Info tambahan jika ada
        const infoItems = [];
        if (pkg.have_daily_limit && pkg.daily_limit_details?.max_daily_transaction_limit) {
            infoItems.push(`📊 Limit: ${pkg.daily_limit_details.max_daily_transaction_limit}/hari`);
        }
        if (pkg.have_cut_off_time && pkg.cut_off_time) {
            infoItems.push(`🕐 Cut-off: ${pkg.cut_off_time.prohibited_hour_starttime}-${pkg.cut_off_time.prohibited_hour_endtime}`);
        }
        if (infoItems.length > 0) {
            packageText += `${infoItems.join(' • ')}\n`;
        }
        
        packageText += `\n`;
    });
    
    // Buat inline keyboard untuk navigasi dan aksi
    const keyboard = {
        inline_keyboard: []
    };
    
    // Row untuk pagination
    const paginationRow = [];
    if (page > 1) {
        paginationRow.push({ text: "⬅️ Prev", callback_data: `pkg_page_${page - 1}` });
    }
    paginationRow.push({ text: `${page}/${totalPages}`, callback_data: `pkg_info` });
    if (page < totalPages) {
        paginationRow.push({ text: "Next ➡️", callback_data: `pkg_page_${page + 1}` });
    }
    keyboard.inline_keyboard.push(paginationRow);
    
    // Row untuk aksi
    keyboard.inline_keyboard.push([
        { text: "🔍 Cari Paket", callback_data: "search_package" },
        { text: "🔄 Refresh", callback_data: "refresh_packages" }
    ]);
    
    keyboard.inline_keyboard.push([
        { text: "📋 Kategori", callback_data: "filter_packages" },
        { text: "❌ Tutup", callback_data: "close_packages" }
    ]);

    try {
        await bot.editMessageText(packageText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } catch (error) {
        log('ERROR', 'Failed to edit package list message', { error: error.message });
    }
}

async function showSearchResults(chatId, messageId, filteredPackages, keyword, page) {
    const itemsPerPage = 6;
    const totalPages = Math.ceil(filteredPackages.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentPackages = filteredPackages.slice(startIndex, endIndex);
    
    let searchText = `🔍 *HASIL PENCARIAN* (${filteredPackages.length} paket)\n`;
    searchText += `📝 Keyword: "*${keyword}*"\n`;
    searchText += `📄 Halaman ${page} dari ${totalPages}\n\n`;
    
    currentPackages.forEach((pkg, index) => {
        const number = startIndex + index + 1;
        searchText += `*${number}. ${pkg.package_name}*\n`;
        searchText += `🔖 \`${pkg.package_code}\`\n`;
        searchText += `💰 ${formatPackagePrice(pkg.package_harga_int)}\n`;
        searchText += `📝 ${truncateText(pkg.package_description, 50)}\n\n`;
    });
    
    const keyboard = {
        inline_keyboard: []
    };
    
    // Pagination untuk hasil pencarian
    const paginationRow = [];
    if (page > 1) {
        paginationRow.push({ text: "⬅️ Prev", callback_data: `search_page_${keyword}_${page - 1}` });
    }
    if (filteredPackages.length > itemsPerPage) {
        paginationRow.push({ text: `${page}/${totalPages}`, callback_data: `search_info` });
    }
    if (page < totalPages) {
        paginationRow.push({ text: "Next ➡️", callback_data: `search_page_${keyword}_${page + 1}` });
    }
    if (paginationRow.length > 0) {
        keyboard.inline_keyboard.push(paginationRow);
    }
    
    keyboard.inline_keyboard.push([
        { text: "🔍 Cari Lagi", callback_data: "search_package" },
        { text: "📋 Semua Paket", callback_data: "refresh_packages" }
    ]);
    
    keyboard.inline_keyboard.push([
        { text: "❌ Tutup", callback_data: "close_packages" }
    ]);

    try {
        await bot.editMessageText(searchText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } catch (error) {
        log('ERROR', 'Failed to edit search results', { error: error.message });
    }
}

async function showPackageDetail(chatId, messageId, pkg) {
    let detailText = `📦 *DETAIL PAKET*\n\n`;
    detailText += `*${pkg.package_name}*\n`;
    detailText += `🔖 Code: \`${pkg.package_code}\`\n`;
    detailText += `💰 Harga: ${formatPackagePrice(pkg.package_harga_int)}\n\n`;
    
    // Deskripsi paket
    detailText += `📝 *Deskripsi:*\n${pkg.package_description || 'Tidak ada deskripsi'}\n\n`;
    
    // Fitur dan pembatasan paket
    detailText += `*📋 Informasi Paket:*\n`;
    detailText += `• Multi transaksi: ${pkg.can_multi_trx ? '✅ Ya' : '❌ Tidak'}\n`;
    detailText += `• Transaksi terjadwal: ${pkg.can_scheduled_trx ? '✅ Ya' : '❌ Tidak'}\n`;
    detailText += `• Perlu login: ${!pkg.no_need_login ? '✅ Ya' : '❌ Tidak'}\n`;
    detailText += `• Cek stok: ${pkg.need_check_stock ? '✅ Ya' : '❌ Tidak'}\n\n`;
    
    // Limit harian jika ada
    if (pkg.have_daily_limit && pkg.daily_limit_details) {
        detailText += `*⚠️ Batasan Harian:*\n`;
        detailText += `• Maksimal: ${pkg.daily_limit_details.max_daily_transaction_limit} transaksi/hari\n`;
        detailText += `• Saat ini: ${pkg.daily_limit_details.current_daily_transaction_count} transaksi\n`;
        detailText += `• Tersisa: ${pkg.daily_limit_details.max_daily_transaction_limit - pkg.daily_limit_details.current_daily_transaction_count} transaksi\n\n`;
    }
    
    // Cut-off time jika ada
    if (pkg.have_cut_off_time && pkg.cut_off_time) {
        detailText += `*🕐 Jam Operasional:*\n`;
        detailText += `• Tidak tersedia: ${pkg.cut_off_time.prohibited_hour_starttime} - ${pkg.cut_off_time.prohibited_hour_endtime}\n\n`;
    }
    
    // Metode pembayaran yang tersedia
    if (pkg.is_show_payment_method && pkg.available_payment_methods?.length > 0) {
        detailText += `*💳 Metode Pembayaran:*\n`;
        pkg.available_payment_methods.forEach((method, index) => {
            detailText += `${index + 1}. ${method.payment_method_display_name}\n`;
            if (method.desc) {
                detailText += `   📝 ${method.desc}\n`;
            }
        });
        detailText += `\n`;
    }

    const keyboard = {
        inline_keyboard: [
            [
                { text: "🛒 Pilih Paket Ini", callback_data: `set_package_${pkg.package_code}` },
                { text: "🔄 Refresh Detail", callback_data: `refresh_detail_${pkg.package_code}` }
            ],
            [
                { text: "📋 Kembali ke Daftar", callback_data: "refresh_packages" },
                { text: "❌ Tutup", callback_data: "close_packages" }
            ]
        ]
    };

    try {
        await bot.editMessageText(detailText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } catch (error) {
        log('ERROR', 'Failed to show package detail', { error: error.message });
    }
}

// ===============================
// DOR TRANSACTION PROCESSING
// ===============================

async function processDorTransaction(chatId, messageId = null) {
    const userData = getUserOtpData(chatId);
    if (!userData || userData.status !== 'logged_in' || !userData.access_token) {
        bot.sendMessage(chatId, "⚠️ Sesi login expired atau tidak valid. Silakan login ulang dengan /mintaotp dan /verifotp!");
        return;
    }

    const userBalance = getUserBalance(chatId);
    const packagePrice = getPackagePrice(DOR_CONFIG.packageCode);
    
    if (userBalance < packagePrice) {
        bot.sendMessage(chatId, 
            `❌ Saldo tidak mencukupi!\n` +
            `💰 Saldo: Rp ${userBalance.toLocaleString('id-ID')}\n` +
            `📦 Harga: Rp ${packagePrice.toLocaleString('id-ID')}`
        );
        return;
    }

    const { nomor_hp, access_token } = userData;
    
    let statusMsg;
    if (messageId) {
        bot.editMessageText("⏳ Memproses pembelian paket...", {
            chat_id: chatId,
            message_id: messageId
        });
    } else {
        statusMsg = await bot.sendMessage(chatId, "⏳ Memproses pembelian paket...");
        messageId = statusMsg.message_id;
    }

    try {
        log('INFO', 'Starting DOR process with balance payment', {
            chatId,
            nomor_hp,
            packageCode: DOR_CONFIG.packageCode,
            userBalance,
            packagePrice
        });

        // Gunakan BALANCE sebagai payment method
        const dorResponse = await processDorRequest(nomor_hp, access_token, DOR_CONFIG.packageCode, 'BALANCE');

        if (dorResponse.status === true && dorResponse.statusCode === 200) {
            const { data } = dorResponse;
            
            // Kurangi balance user
            const newBalance = updateUserBalance(chatId, packagePrice, 'subtract');
            
            // Simpan riwayat transaksi
            saveTransactionHistory(chatId, {
                trx_id: data.trx_id,
                package_name: data.package_name,
                amount: packagePrice,
                balance_before: userBalance,
                balance_after: newBalance,
                target_number: data.msisdn,
                timestamp: new Date().toISOString(),
                status: 'success'
            });

            bot.editMessageText(
                `✅ *PEMBELIAN BERHASIL!*\n\n` +
                `📦 *Detail Pembelian:*\n` +
                `📱 Nomor: ${data.msisdn}\n` +
                `📋 Paket: ${data.package_name}\n` +
                `💰 Harga: Rp ${packagePrice.toLocaleString('id-ID')}\n` +
                `🔖 ID Transaksi: ${data.trx_id}\n\n` +
                `💳 *Balance Update:*\n` +
                `• Saldo sebelum: Rp ${userBalance.toLocaleString('id-ID')}\n` +
                `• Saldo sesudah: Rp ${newBalance.toLocaleString('id-ID')}\n\n` +
                `✅ Paket berhasil diaktifkan! Terima kasih.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                }
            );

            log('INFO', 'DOR with balance completed successfully', {
                chatId,
                trxId: data.trx_id,
                newBalance
            });

        } else {
            throw new Error(dorResponse.message || "Gagal memproses pembelian paket");
        }

    } catch (error) {
        log('ERROR', 'DOR process failed', {
            error: error.message,
            response: error.response?.data,
            chatId,
            nomor_hp
        });

        let errorMessage = "Gagal memproses pembelian";
        if (error.response?.data?.message) {
            errorMessage = error.response.data.message;
        } else {
            errorMessage = error.message;
        }

        bot.editMessageText(`❌ ${errorMessage}`, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// ===============================
// COMMAND HANDLERS
// ===============================

// Command /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const menuText = `
🤖 *Selamat datang di Bot XL DOR!*

📋 *CARA PENGGUNAAN:*

1️⃣ /mintaotp <nomor>
   Contoh: /mintaotp 087777334618

2️⃣ /verifotp <kode>
   Contoh: /verifotp 123456

📦 *PAKET COMMANDS:*
/listpaket - Lihat semua paket XL
/caripaket <keyword> - Cari paket tertentu
/infopaket <code> - Detail paket spesifik
/setpackage <code> - Set paket untuk pembelian

🛒 *PEMBELIAN:*
/dor - Info paket dan konfirmasi
/lanjutdor - Proses pembelian

💰 *BALANCE COMMANDS:*
/balance - Cek saldo balance
/topup - Top up balance
/history - Riwayat transaksi

/status - Cek status login
/logout - Logout dan hapus data
/menu - Tampilkan menu ini

⚠️ *PERHATIAN:*
• Nomor target harus pelanggan XL aktif
• Sesi login berlaku 1 jam
• OTP berlaku 5 menit
• Pembelian menggunakan balance otomatis

📦 *Package saat ini:* ${DOR_CONFIG.packageCode}
💰 *Balance minimal:* Rp ${DOR_CONFIG.minBalance.toLocaleString('id-ID')}
`;

    bot.sendMessage(chatId, menuText, {parse_mode: 'Markdown'});
    log('INFO', 'New user started bot', { chatId, username: msg.from.username });
});

// Command /menu
bot.onText(/\/menu/, async (msg) => {
    bot.onText(/\/start/, async (msg) => {
        // Same as /start
    });
});

// Command /mintaotp
bot.onText(/\/mintaotp (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const nomorHp = match[1].trim();

    // Validasi nomor HP
    if (!/^08\d{8,12}$/.test(nomorHp)) {
        bot.sendMessage(chatId,
            "❌ Format nomor tidak valid!\n\n" +
            "Format yang benar: 08xxxxxxxxx\n" +
            "Contoh: 087777334618"
        );
        return;
    }

    const statusMsg = await bot.sendMessage(chatId, "⏳ Mengirim OTP...");

    try {
        const otpResponse = await requestOtp(nomorHp);

        if (otpResponse.status === true && otpResponse.statusCode === 200) {
            const { data } = otpResponse;
            
            // Simpan data OTP
            const otpData = loadOtpData();
            otpData[chatId] = {
                auth_id: data.auth_id,
                nomor_hp: nomorHp,
                status: 'otp_sent',
                otp_sent_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString(), // 5 menit
                can_resend_at: new Date(Date.now() + (data.can_resend_in * 1000)).toISOString()
            };
            saveOtpData(otpData);

            bot.editMessageText(
                `✅ OTP berhasil dikirim!\n\n` +
                `📱 Silakan cek SMS Anda untuk mendapatkan kode OTP\n` +
                `Ketik /verifotp <kode> untuk verifikasi\n` +
                `⏰ Kode berlaku 5 menit\n` +
                `🔄 Dapat mengirim ulang dalam ${data.can_resend_in} detik`,
                {
                    chat_id: chatId,
                    message_id: statusMsg.message_id
                }
            );

            log('INFO', 'OTP request successful', {
                chatId,
                targetNumber: nomorHp,
                authId: data.auth_id,
                canResendIn: data.can_resend_in
            });

        } else {
            throw new Error(otpResponse.message || "Gagal mengirim OTP");
        }

    } catch (error) {
        log('ERROR', 'OTP request failed', {
            error: error.message,
            response: error.response?.data,
            chatId,
            nomorHp
        });

        let errorMessage = "Gagal mengirim OTP";
        if (error.response?.data?.message) {
            errorMessage = error.response.data.message;
        } else {
            errorMessage = error.message;
        }

        bot.editMessageText(`❌ ${errorMessage}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id
        });
    }
});

// Command /verifotp
bot.onText(/\/verifotp (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const otpCode = match[1].trim();

    // Validasi kode OTP
    if (!/^\d{4,6}$/.test(otpCode)) {
        bot.sendMessage(chatId,
            "❌ Format OTP tidak valid!\n\n" +
            "Format yang benar: 4-6 digit angka\n" +
            "Contoh: 123456"
        );
        return;
    }

    const userData = getUserOtpData(chatId);
    if (!userData || userData.status !== 'otp_sent' || !userData.auth_id) {
        bot.sendMessage(chatId,
            "⚠️ Anda belum meminta OTP atau OTP sudah expired.\n\n" +
            "Silakan minta OTP baru dengan /mintaotp <nomor>"
        );
        return;
    }

    // Cek apakah OTP masih berlaku
    if (new Date() > new Date(userData.expires_at)) {
        bot.sendMessage(chatId,
            "⚠️ OTP sudah expired. Silakan minta OTP baru dengan /mintaotp"
        );
        return;
    }

    const statusMsg = await bot.sendMessage(chatId, "⏳ Memverifikasi OTP...");

    try {
        const verifyResponse = await verifyOtp(userData.auth_id, otpCode);

        if (verifyResponse.status === true && verifyResponse.statusCode === 200) {
            const { data } = verifyResponse;
            
            // Update data user
            const otpData = loadOtpData();
            otpData[chatId] = {
                ...otpData[chatId],
                access_token: data.access_token,
                status: 'logged_in',
                verified_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + (60 * 60 * 1000)).toISOString() // 1 jam
            };
            saveOtpData(otpData);

            bot.editMessageText(
                `✅ Verifikasi OTP berhasil!\n\n` +
                `📱 Anda sudah login ke sistem XL\n` +
                `Ketik /dor untuk melanjutkan pembelian\n` +
                `⏰ Sesi login berlaku 60 menit\n` +
                `🔑 Token: ${data.access_token.substring(0, 20)}...`,
                {
                    chat_id: chatId,
                    message_id: statusMsg.message_id
                }
            );

            log('INFO', 'OTP verification successful', {
                chatId,
                nomorHp: userData.nomor_hp,
                authId: userData.auth_id
            });

        } else {
            throw new Error(verifyResponse.message || "Gagal memverifikasi OTP");
        }

    } catch (error) {
        log('ERROR', 'OTP verification failed', {
            error: error.message,
            response: error.response?.data,
            chatId,
            authId: userData.auth_id
        });

        let errorMessage = "Gagal memverifikasi OTP";
        if (error.response?.data?.message) {
            errorMessage = error.response.data.message;
        } else {
            errorMessage = error.message;
        }

        bot.editMessageText(`❌ ${errorMessage}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id
        });
    }
});

// Command /balance
bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    const balance = getUserBalance(chatId);
    
    bot.sendMessage(chatId, 
        `💰 *BALANCE ANDA*\n\n` +
        `💳 Saldo: Rp ${balance.toLocaleString('id-ID')}\n` +
        `📦 Harga paket saat ini: Rp ${getPackagePrice(DOR_CONFIG.packageCode).toLocaleString('id-ID')}\n\n` +
        `${balance >= getPackagePrice(DOR_CONFIG.packageCode) ? '✅' : '❌'} ` +
        `${balance >= getPackagePrice(DOR_CONFIG.packageCode) ? 'Saldo mencukupi' : 'Saldo tidak mencukupi'}\n\n` +
        `Ketik /topup untuk mengisi saldo`,
        {parse_mode: 'Markdown'}
    );
});

// Command /topup
bot.onText(/\/topup/, async (msg) => {
    const chatId = msg.chat.id;
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: "💰 Top Up Rp 10.000", callback_data: "topup_10000" },
                { text: "💰 Top Up Rp 25.000", callback_data: "topup_25000" }
            ],
            [
                { text: "💰 Top Up Rp 50.000", callback_data: "topup_50000" },
                { text: "💰 Top Up Rp 100.000", callback_data: "topup_100000" }
            ],
            [
                { text: "💳 Custom Amount", callback_data: "topup_custom" }
            ]
        ]
    };
    
    bot.sendMessage(chatId,
        `💰 *TOP UP BALANCE*\n\n` +
        `Pilih nominal yang ingin Anda top up:`,
        {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        }
    );
});

// Command /topup_amount untuk custom amount
bot.onText(/\/topup_amount (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const amount = parseInt(match[1].trim());
    
    if (isNaN(amount) || amount < 1000) {
        bot.sendMessage(chatId, "⚠️ Nominal minimal Rp 1.000");
        return;
    }
    
    if (amount > 1000000) {
        bot.sendMessage(chatId, "⚠️ Nominal maksimal Rp 1.000.000");
        return;
    }
    
    // Simulasi top up berhasil
    const newBalance = updateUserBalance(chatId, amount, 'add');
    
    bot.sendMessage(chatId,
        `✅ *TOP UP BERHASIL!*\n\n` +
        `💰 Nominal: Rp ${amount.toLocaleString('id-ID')}\n` +
        `💳 Saldo baru: Rp ${newBalance.toLocaleString('id-ID')}\n\n` +
        `Terima kasih! Saldo Anda telah ditambahkan.`,
        {parse_mode: 'Markdown'}
    );
});

// Command /dor
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

    const userBalance = getUserBalance(chatId);
    const packagePrice = getPackagePrice(DOR_CONFIG.packageCode);
    
    if (userBalance < packagePrice) {
        bot.sendMessage(chatId,
            `⚠️ *SALDO TIDAK MENCUKUPI* ⚠️\n\n` +
            `💰 Saldo Anda: Rp ${userBalance.toLocaleString('id-ID')}\n` +
            `📦 Harga paket: Rp ${packagePrice.toLocaleString('id-ID')}\n` +
            `❌ Kekurangan: Rp ${(packagePrice - userBalance).toLocaleString('id-ID')}\n\n` +
            `Silakan top up balance terlebih dahulu dengan /topup`,
            {parse_mode: 'Markdown'}
        );
        return;
    }

    const keyboard = {
        inline_keyboard: [
            [
                { text: "✅ Lanjutkan Pembelian", callback_data: "confirm_dor" },
                { text: "❌ Batal", callback_data: "cancel_dor" }
            ]
        ]
    };

    bot.sendMessage(chatId,
        `⚠️ *KONFIRMASI PEMBELIAN PAKET* ⚠️\n\n` +
        `📦 *Paket yang akan dibeli:*\n` +
        `${DOR_CONFIG.packageCode}\n\n` +
        `💰 *Detail Pembayaran:*\n` +
        `• Saldo saat ini: Rp ${userBalance.toLocaleString('id-ID')}\n` +
        `• Harga paket: Rp ${packagePrice.toLocaleString('id-ID')}\n` +
        `• Sisa saldo: Rp ${(userBalance - packagePrice).toLocaleString('id-ID')}\n\n` +
        `💳 *Metode Pembayaran:* BALANCE (Otomatis)\n\n` +
        `Klik tombol di bawah untuk melanjutkan atau batalkan`,
        {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        }
    );
});

// Command /lanjutdor
bot.onText(/\/lanjutdor/, async (msg) => {
    const chatId = msg.chat.id;
    await processDorTransaction(chatId);
});

// Command /status
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const userData = getUserOtpData(chatId);
    const balance = getUserBalance(chatId);

    if (!userData) {
        bot.sendMessage(chatId,
            "📊 *STATUS AKUN*\n\n" +
            "❌ Belum login\n" +
            `💳 Balance: Rp ${balance.toLocaleString('id-ID')}\n\n` +
            "Ketik /mintaotp <nomor> untuk login"
        );
        return;
    }

    let statusText = "📊 *STATUS AKUN*\n\n";
    statusText += `👤 User ID: ${chatId}\n`;
    statusText += `📱 Target: ${userData.nomor_hp || 'N/A'}\n`;
    statusText += `📊 Status: ${userData.status}\n`;
    statusText += `💳 Balance: Rp ${balance.toLocaleString('id-ID')}\n`;

    if (userData.status === 'logged_in' && userData.expires_at) {
        const expiresAt = new Date(userData.expires_at);
        const now = new Date();
        const timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000 / 60));
        statusText += `⏰ Sisa waktu: ${timeLeft}m\n`;
    }

    statusText += `📦 Package: ${DOR_CONFIG.packageCode}\n`;
    statusText += `💳 Payment: BALANCE\n`;

    if (userData.access_token) {
        statusText += `🔑 Token: ${userData.access_token.substring(0, 20)}...\n`;
    }

    bot.sendMessage(chatId, statusText, {parse_mode: 'Markdown'});
});

// Command /logout
bot.onText(/\/logout/, async (msg) => {
    const chatId = msg.chat.id;
    
    const otpData = loadOtpData();
    if (otpData[chatId]) {
        delete otpData[chatId];
        saveOtpData(otpData);
        
        bot.sendMessage(chatId,
            "✅ Logout berhasil!\n\n" +
            "Data sesi Anda telah dihapus.\n" +
            "Ketik /start untuk memulai lagi."
        );
        
        log('INFO', 'User logged out', { chatId });
    } else {
        bot.sendMessage(chatId, "⚠️ Anda belum login");
    }
});

// Command /setpackage
bot.onText(/\/setpackage (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const packageCode = match[1].trim();
    
    // Validasi package code (bisa ditambahkan validasi ke API)
    DOR_CONFIG.packageCode = packageCode;
    
    // Simpan ke user data juga
    const otpData = loadOtpData();
    if (otpData[chatId]) {
        otpData[chatId].selected_package = packageCode;
        saveOtpData(otpData);
    }
    
    bot.sendMessage(chatId,
        `✅ Package berhasil diubah!\n\n` +
        `📦 Package baru: ${packageCode}\n` +
        `💰 Estimasi harga: Rp ${getPackagePrice(packageCode).toLocaleString('id-ID')}\n\n` +
        `Ketik /dor untuk melanjutkan pembelian dengan package ini.`
    );
    
    log('INFO', 'Package code changed', { chatId, newPackageCode: packageCode });
});

// ===============================
// PACKAGE LIST COMMANDS
// ===============================

// Command /listpaket
bot.onText(/\/listpaket/, async (msg) => {
    const chatId = msg.chat.id;
    
    const statusMsg = await bot.sendMessage(chatId, "⏳ Mengambil daftar paket XL dari server...");
    
    try {
        const packages = await fetchPackageList();
        
        if (!packages || packages.length === 0) {
            bot.editMessageText("❌ Tidak ada paket yang tersedia saat ini", {
                chat_id: chatId,
                message_id: statusMsg.message_id
            });
            return;
        }

        // Tampilkan halaman pertama dengan pagination
        await showPackageListPage(chatId, statusMsg.message_id, packages, 1);
        
    } catch (error) {
        bot.editMessageText(
            `❌ Gagal mengambil daftar paket: ${error.message}\n\n` +
            `Silakan coba lagi atau hubungi admin jika masalah berlanjut.`,
            {
                chat_id: chatId,
                message_id: statusMsg.message_id
            }
        );
    }
});

// Command /caripaket
bot.onText(/\/caripaket (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const keyword = match[1].trim().toLowerCase();
    
    if (keyword.length < 2) {
        bot.sendMessage(chatId, "⚠️ Keyword minimal 2 karakter");
        return;
    }
    
    const statusMsg = await bot.sendMessage(chatId, `🔍 Mencari paket dengan keyword: "*${keyword}*"...`, {parse_mode: 'Markdown'});
    
    try {
        const packages = await fetchPackageList();
        
        // Filter paket berdasarkan keyword
        const filteredPackages = packages.filter(pkg => 
            pkg.package_name.toLowerCase().includes(keyword) ||
            pkg.package_code.toLowerCase().includes(keyword) ||
            (pkg.package_description && pkg.package_description.toLowerCase().includes(keyword))
        );
        
        if (filteredPackages.length === 0) {
            bot.editMessageText(
                `🔍 *HASIL PENCARIAN*\n\n` +
                `❌ Tidak ditemukan paket dengan keyword: "*${keyword}*"\n\n` +
                `💡 *Tips pencarian:*\n` +
                `• Coba kata kunci lain seperti "unlimited", "combo", "2gb"\n` +
                `• Gunakan kata kunci yang lebih umum\n` +
                `• Ketik /listpaket untuk melihat semua paket`,
                {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'Markdown'
                }
            );
            return;
        }

        // Tampilkan hasil pencarian
        await showSearchResults(chatId, statusMsg.message_id, filteredPackages, keyword, 1);
        
    } catch (error) {
        bot.editMessageText(
            `❌ Gagal mencari paket: ${error.message}`,
            {
                chat_id: chatId,
                message_id: statusMsg.message_id
            }
        );
    }
});

// Command /infopaket
bot.onText(/\/infopaket (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const packageCode = match[1].trim();
    
    const statusMsg = await bot.sendMessage(chatId, "⏳ Mengambil detail paket...");
    
    try {
        const packages = await fetchPackageList();
        const pkg = packages.find(p => p.package_code === packageCode);
        
        if (!pkg) {
            bot.editMessageText(
                `❌ *PAKET TIDAK DITEMUKAN*\n\n` +
                `🔖 Code: \`${packageCode}\`\n\n` +
                `💡 Pastikan code paket benar atau ketik /listpaket untuk melihat daftar yang tersedia.`,
                {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'Markdown'
                }
            );
            return;
        }

        await showPackageDetail(chatId, statusMsg.message_id, pkg);
        
    } catch (error) {
        bot.editMessageText(
            `❌ Gagal mengambil detail paket: ${error.message}`,
            {
                chat_id: chatId,
                message_id: statusMsg.message_id
            }
        );
    }
});

// ===============================
// ADMIN COMMANDS
// ===============================

// Command /admin
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;

    if (!isAdmin(chatId)) {
        bot.sendMessage(chatId, "❌ Anda tidak memiliki akses admin!");
        return;
    }

    const adminMenu = `
🔧 *ADMIN PANEL*

💰 **Balance Management:**
/admin_topup [user_id] [amount] [reason] - Top up user balance
/admin_setbalance [user_id] [amount] [reason] - Set user balance
/admin_checkbalance [user_id] - Cek balance user

📊 **User Management:**
/admin_history [user_id] - Riwayat transaksi user  
/admin_userinfo [user_id] - Info lengkap user
/admin_stats - Statistik bot

📋 **System:**
/admin_broadcast [message] - Broadcast ke semua user
/admin_logs - Lihat log sistem
/admin_backup - Backup data

👥 **Super Admin Only:**
/admin_add [user_id] - Tambah admin baru
/admin_remove [user_id] - Hapus admin

**Contoh penggunaan:**
/admin_topup 123456789 50000 Bonus
/admin_setbalance 123456789 100000 Reset balance
/admin_checkbalance 123456789
`;

    bot.sendMessage(chatId, adminMenu, {parse_mode: 'Markdown'});
});

// Command /admin_topup
bot.onText(/\/admin_topup (\d+) (\d+) ?(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const targetUserId = parseInt(match[1]);
    const amount = parseInt(match[2]);
    const reason = match[3] || 'Admin top up';

    // Validasi admin
    if (!isAdmin(chatId)) {
        bot.sendMessage(chatId, "❌ Anda tidak memiliki akses admin!");
        return;
    }

    if (amount < 100) {
        bot.sendMessage(chatId, "⚠️ Minimal top up Rp 100");
        return;
    }

    if (amount > 10000000) {
        bot.sendMessage(chatId, "⚠️ Maksimal top up Rp 10.000.000");
        return;
    }

    try {
        // Top up balance user
        const oldBalance = getUserBalance(targetUserId);
        const newBalance = updateUserBalance(targetUserId, amount, 'add');
        
        // Simpan log admin action
        saveAdminAction(chatId, {
            action: 'TOPUP_USER',
            target_user_id: targetUserId,
            amount: amount,
            old_balance: oldBalance,
            new_balance: newBalance,
            reason: reason,
            timestamp: new Date().toISOString()
        });

        // Kirim konfirmasi ke admin
        bot.sendMessage(chatId,
            `✅ *TOP UP BERHASIL*\n\n` +
            `👤 Target User: ${targetUserId}\n` +
            `💰 Jumlah Top Up: Rp ${amount.toLocaleString('id-ID')}\n` +
            `💳 Balance Lama: Rp ${oldBalance.toLocaleString('id-ID')}\n` +
            `💳 Balance Baru: Rp ${newBalance.toLocaleString('id-ID')}\n` +
            `📝 Alasan: ${reason}\n` +
            `👨‍💼 Admin: ${msg.from.first_name} (${chatId})`,
            {parse_mode: 'Markdown'}
        );

        // Kirim notifikasi ke user target (jika user aktif)
        try {
            bot.sendMessage(targetUserId,
                `🎉 *BALANCE TOP UP*\n\n` +
                `💰 Anda mendapat top up sebesar Rp ${amount.toLocaleString('id-ID')}\n` +
                `💳 Balance baru: Rp ${newBalance.toLocaleString('id-ID')}\n` +
                `📝 Keterangan: ${reason}\n` +
                `⏰ Waktu: ${new Date().toLocaleString('id-ID')}\n\n` +
                `Terima kasih! 🙏`,
                {parse_mode: 'Markdown'}
            );
        } catch (error) {
            // User belum pernah start bot atau block bot
            log('WARN', 'Could not notify user about top up', { targetUserId, error: error.message });
        }

        log('INFO', 'Admin top up completed', {
            adminId: chatId,
            targetUserId,
            amount,
            newBalance
        });

    } catch (error) {
        log('ERROR', 'Admin top up failed', {
            error: error.message,
            adminId: chatId,
            targetUserId,
            amount
        });

        bot.sendMessage(chatId, `❌ Gagal melakukan top up: ${error.message}`);
    }
});

// Command /admin_setbalance
bot.onText(/\/admin_setbalance (\d+) (\d+) ?(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const targetUserId = parseInt(match[1]);
    const newAmount = parseInt(match[2]);
    const reason = match[3] || 'Admin set balance';

    if (!isAdmin(chatId)) {
        bot.sendMessage(chatId, "❌ Anda tidak memiliki akses admin!");
        return;
    }

    if (newAmount < 0) {
        bot.sendMessage(chatId, "⚠️ Balance tidak boleh negatif");
        return;
    }

    try {
        const oldBalance = getUserBalance(targetUserId);
        const newBalance = updateUserBalance(targetUserId, newAmount, 'set');
        
        saveAdminAction(chatId, {
            action: 'SET_BALANCE',
            target_user_id: targetUserId,
            old_balance: oldBalance,
            new_balance: newBalance,
            reason: reason,
            timestamp: new Date().toISOString()
        });

        bot.sendMessage(chatId,
            `✅ *BALANCE DIUBAH*\n\n` +
            `👤 Target User: ${targetUserId}\n` +
            `💳 Balance Lama: Rp ${oldBalance.toLocaleString('id-ID')}\n` +
            `💳 Balance Baru: Rp ${newBalance.toLocaleString('id-ID')}\n` +
            `📝 Alasan: ${reason}`,
            {parse_mode: 'Markdown'}
        );

        // Notifikasi ke user
        try {
            bot.sendMessage(targetUserId,
                `📋 *BALANCE UPDATE*\n\n` +
                `💳 Balance Anda telah diubah menjadi: Rp ${newBalance.toLocaleString('id-ID')}\n` +
                `📝 Keterangan: ${reason}`,
                {parse_mode: 'Markdown'}
            );
        } catch (error) {
            log('WARN', 'Could not notify user about balance change', { targetUserId });
        }

        log('INFO', 'Admin set balance completed', {
            adminId: chatId,
            targetUserId,
            oldBalance,
            newBalance
        });

    } catch (error) {
        bot.sendMessage(chatId, `❌ Gagal mengubah balance: ${error.message}`);
    }
});

// Command /admin_checkbalance
bot.onText(/\/admin_checkbalance (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const targetUserId = parseInt(match[1]);

    if (!isAdmin(chatId)) {
        bot.sendMessage(chatId, "❌ Anda tidak memiliki akses admin!");
        return;
    }

    try {
        const balance = getUserBalance(targetUserId);
        const userData = getUserOtpData(targetUserId);
        
        bot.sendMessage(chatId,
            `👤 *USER BALANCE INFO*\n\n` +
            `🆔 User ID: ${targetUserId}\n` +
            `💰 Balance: Rp ${balance.toLocaleString('id-ID')}\n` +
            `📱 Nomor HP: ${userData?.nomor_hp || 'Belum ada'}\n` +
            `📊 Status: ${userData?.status || 'Belum pernah login'}\n` +
            `⏰ Last Active: ${userData?.verified_at || 'N/A'}`,
            {parse_mode: 'Markdown'}
        );

    } catch (error) {
        bot.sendMessage(chatId, `❌ Gagal mengecek balance: ${error.message}`);
    }
});

// Command /admin_stats
bot.onText(/\/admin_stats/, async (msg) => {
    const chatId = msg.chat.id;

    if (!isAdmin(chatId)) {
        bot.sendMessage(chatId, "❌ Anda tidak memiliki akses admin!");
        return;
    }

    try {
        const otpData = loadOtpData();
        const userIds = Object.keys(otpData);
        
        // Hitung total balance semua user
        let totalBalance = 0;
        let activeUsers = 0;
        let loggedInUsers = 0;

        userIds.forEach(userId => {
            const balance = getUserBalance(userId);
            totalBalance += balance;
            
            const userData = otpData[userId];
            if (userData) {
                if (userData.status === 'logged_in') {
                    loggedInUsers++;
                }
                if (userData.verified_at) {
                    activeUsers++;
                }
            }
        });

        // Hitung total transaksi
        let totalTransactions = 0;
        let totalRevenue = 0;
        try {
            const historyData = fs.readFileSync('transaction_history.json', 'utf8');
            const history = JSON.parse(historyData);
            
            Object.values(history).forEach(userHistory => {
                userHistory.forEach(tx => {
                    if (tx.status === 'success') {
                        totalTransactions++;
                        totalRevenue += tx.amount || 0;
                    }
                });
            });
        } catch (error) {
            // File tidak ada
        }

        bot.sendMessage(chatId,
            `📊 *STATISTIK BOT*\n\n` +
            `👥 Total Users: ${userIds.length}\n` +
            `🟢 Active Users: ${activeUsers}\n` +
            `🔑 Logged In: ${loggedInUsers}\n\n` +
            `💰 Total Balance: Rp ${totalBalance.toLocaleString('id-ID')}\n` +
            `💳 Total Transaksi: ${totalTransactions}\n` +
            `💵 Total Revenue: Rp ${totalRevenue.toLocaleString('id-ID')}\n\n` +
            `🕐 Update: ${new Date().toLocaleString('id-ID')}`,
            {parse_mode: 'Markdown'}
        );

    } catch (error) {
        bot.sendMessage(chatId, `❌ Gagal mengambil statistik: ${error.message}`);
    }
});

// Command /admin_broadcast
bot.onText(/\/admin_broadcast (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const broadcastMessage = match[1];

    if (!isAdmin(chatId)) {
        bot.sendMessage(chatId, "❌ Anda tidak memiliki akses admin!");
        return;
    }

    try {
        const otpData = loadOtpData();
        const userIds = Object.keys(otpData);
        let successCount = 0;
        let failCount = 0;

        const statusMsg = await bot.sendMessage(chatId, 
            `📢 Memulai broadcast ke ${userIds.length} users...`
        );

        for (const userId of userIds) {
            try {
                await bot.sendMessage(userId, 
                    `📢 *PENGUMUMAN*\n\n${broadcastMessage}`, 
                    {parse_mode: 'Markdown'}
                );
                successCount++;
                
                // Delay untuk menghindari rate limit
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                failCount++;
                log('WARN', 'Broadcast failed for user', { userId, error: error.message });
            }
        }

        bot.editMessageText(
            `✅ Broadcast selesai!\n\n` +
            `📤 Berhasil: ${successCount}\n` +
            `❌ Gagal: ${failCount}\n` +
            `📊 Total: ${userIds.length}`,
            {
                chat_id: chatId,
                message_id: statusMsg.message_id
            }
        );

        saveAdminAction(chatId, {
            action: 'BROADCAST',
            message: broadcastMessage,
            success_count: successCount,
            fail_count: failCount,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        bot.sendMessage(chatId, `❌ Gagal broadcast: ${error.message}`);
    }
});

// ===============================
// CALLBACK QUERY HANDLER
// ===============================

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;

    try {
        // Handle top up callbacks
        if (data.startsWith('topup_')) {
            const amount = data.replace('topup_', '');
            
            if (amount === 'custom') {
                bot.editMessageText(
                    "💰 *CUSTOM TOP UP*\n\n" +
                    "Ketik nominal yang ingin Anda top up:\n" +
                    "Format: /topup_amount <nominal>\n" +
                    "Contoh: /topup_amount 75000",
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown'
                    }
                );
            } else {
                const topupAmount = parseInt(amount);
                // Simulasi top up berhasil (dalam implementasi nyata, integrasikan dengan payment gateway)
                const newBalance = updateUserBalance(chatId, topupAmount, 'add');
                
                bot.editMessageText(
                    `✅ *TOP UP BERHASIL!*\n\n` +
                    `💰 Nominal: Rp ${topupAmount.toLocaleString('id-ID')}\n` +
                    `💳 Saldo baru: Rp ${newBalance.toLocaleString('id-ID')}\n\n` +
                    `Terima kasih! Saldo Anda telah ditambahkan.`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown'
                    }
                );
            }
        }
        
        // Handle DOR confirmations
        else if (data === 'confirm_dor') {
            await processDorTransaction(chatId, messageId);
        } else if (data === 'cancel_dor') {
            bot.editMessageText("❌ Transaksi dibatalkan", {
                chat_id: chatId,
                message_id: messageId
            });
        }
        
        // Handle package list pagination
        else if (data.startsWith('pkg_page_')) {
            const page = parseInt(data.replace('pkg_page_', ''));
            const packages = await fetchPackageList();
            await showPackageListPage(chatId, messageId, packages, page);
        }
        
        // Handle search pagination
        else if (data.startsWith('search_page_')) {
            const parts = data.replace('search_page_', '').split('_');
            const keyword = parts.slice(0, -1).join('_');
            const page = parseInt(parts[parts.length - 1]);
            
            const packages = await fetchPackageList();
            const filteredPackages = packages.filter(pkg => 
                pkg.package_name.toLowerCase().includes(keyword.toLowerCase()) ||
                pkg.package_code.toLowerCase().includes(keyword.toLowerCase()) ||
                (pkg.package_description && pkg.package_description.toLowerCase().includes(keyword.toLowerCase()))
            );
            
            await showSearchResults(chatId, messageId, filteredPackages, keyword, page);
        }
        
        // Handle refresh packages
        else if (data === 'refresh_packages') {
            const packages = await fetchPackageList(true); // Force refresh
            await showPackageListPage(chatId, messageId, packages, 1);
            bot.answerCallbackQuery(callbackQuery.id, {
                text: "✅ Daftar paket berhasil diperbarui!"
            });
        }
        
        // Handle search package
        else if (data === 'search_package') {
            bot.editMessageText(
                "🔍 *PENCARIAN PAKET*\n\n" +
                "Untuk mencari paket, gunakan command:\n" +
                "`/caripaket <keyword>`\n\n" +
                "*Contoh pencarian:*\n" +
                "• `/caripaket unlimited` - Cari paket unlimited\n" +
                "• `/caripaket combo` - Cari paket combo\n" +
                "• `/caripaket 2gb` - Cari paket dengan kuota 2GB\n" +
                "• `/caripaket turbo` - Cari paket turbo\n\n" +
                "Ketik /listpaket untuk kembali ke daftar lengkap.",
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                }
            );
        }
        
        // Handle set package
        else if (data.startsWith('set_package_')) {
            const packageCode = data.replace('set_package_', '');
            
            // Update package config
            DOR_CONFIG.packageCode = packageCode;
            
            // Simpan ke user data jika perlu
            const otpData = loadOtpData();
            if (otpData[chatId]) {
                otpData[chatId].selected_package = packageCode;
                saveOtpData(otpData);
            }
            
            bot.editMessageText(
                `✅ *PAKET BERHASIL DIPILIH*\n\n` +
                `📦 Paket aktif: \`${packageCode}\`\n\n` +
                `Sekarang Anda dapat melakukan pembelian dengan paket ini.\n` +
                `Ketik /dor untuk melanjutkan pembelian.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                }
            );
            
            log('INFO', 'Package selected from package list', { 
                chatId, 
                packageCode 
            });
        }
        
        // Handle refresh detail
        else if (data.startsWith('refresh_detail_')) {
            const packageCode = data.replace('refresh_detail_', '');
            const packages = await fetchPackageList(true);
            const pkg = packages.find(p => p.package_code === packageCode);
            
            if (pkg) {
                await showPackageDetail(chatId, messageId, pkg);
                bot.answerCallbackQuery(callbackQuery.id, {
                    text: "✅ Detail paket diperbarui!"
                });
            } else {
                bot.answerCallbackQuery(callbackQuery.id, {
                    text: "❌ Paket tidak ditemukan",
                    show_alert: true
                });
            }
        }
        
        // Handle close packages
        else if (data === 'close_packages') {
            bot.editMessageText("📦 Daftar paket ditutup.", {
                chat_id: chatId,
                message_id: messageId
            });
        }

    } catch (error) {
        log('ERROR', 'Callback query error', { error: error.message, data });
        bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ Terjadi kesalahan, silakan coba lagi",
            show_alert: true
        });
    }

    bot.answerCallbackQuery(callbackQuery.id);
});

// ===============================
// ERROR HANDLING
// ===============================

bot.on('polling_error', (error) => {
    log('ERROR', 'Polling error', { error: error.message });
});

process.on('unhandledRejection', (reason, promise) => {
    log('ERROR', 'Unhandled Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
    log('ERROR', 'Uncaught Exception', { error: error.message });
    process.exit(1);
});

// ===============================
// STARTUP MESSAGE
// ===============================

console.log(`
🤖 XL DOR Bot berhasil dijalankan!
📅 Waktu: ${new Date().toLocaleString('id-ID')}
🔧 Mode: ${process.env.NODE_ENV || 'development'}

📋 Fitur yang tersedia:
• Sistem OTP dan autentikasi XL
• Balance management
• Package list dengan API
• Admin panel
• Real-time package information
• Transaction history

✅ Bot siap digunakan!
`);
