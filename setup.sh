#!/bin/bash

# Warna
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

echo -e "${CYAN}🛠️  Memulai setup untuk bot lo...${RESET}"

echo -e "${YELLOW}🔄 Update sistem & install tools penting...${RESET}"
sudo apt-get update -y
sudo apt-get install -y curl wget gnupg ca-certificates lsb-release

echo -e "${YELLOW}🕒 Setting timezone ke WIB (Asia/Jakarta)...${RESET}"
sudo timedatectl set-timezone Asia/Jakarta

echo -e "${YELLOW}📦 Install Node.js v20.x, sabar ya...${RESET}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo -e "${GREEN}✅ Node.js version: $(node -v)${RESET}"
echo -e "${GREEN}✅ npm version: $(npm -v)${RESET}"

echo -e "${YELLOW}📁 Install dependencies dari package.json...${RESET}"
npm install

# Check .env
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  File .env gak ada, bikin dari .env.example...${RESET}"
    cp .env.example .env
fi

echo -e "${CYAN}📝 Masukkan konfigurasi penting buat bot kamu${RESET}"
read -p "👤 ADMIN_ID: " ADMIN_ID
read -p "📢 GROUP_ID: " LOGGING_GROUP_ID
read -p "💳 QRIS_MERCHANT_ID: " QRIS_MERCHANT_ID
read -p "🔑 QRIS_API_KEY: " QRIS_API_KEY
read -p "📌 QRIS_BASE_QR_STRING: " QRIS_BASE_QR_STRING
read -p "💳 HARGA: " BASE_PRICE
read -p "🚪 API_KEY: " DOR_API_KEY
read -p "🤖 BOT_TOKEN: " BOT_TOKEN
read -p "👥 ID_TELEGRAM UNTUK API: " ID_TELEGRAM
read -p "🔐 PASSWORD: " PASSWORD

cat > .env <<EOF
ADMIN_ID=$ADMIN_ID
LOGGING_GROUP_ID=$LOGGING_GROUP_ID
QRIS_MERCHANT_ID=$QRIS_MERCHANT_ID
QRIS_API_KEY=$QRIS_API_KEY
QRIS_BASE_QR_STRING=$QRIS_BASE_QR_STRING
BASE_PRICE=$BASE_PRICE
DOR_API_KEY=$DOR_API_KEY
BOT_TOKEN=$BOT_TOKEN
ID_TELEGRAM=$ID_TELEGRAM
PASSWORD=$PASSWORD
EOF

echo -e "${GREEN}✅ .env berhasil dibuat dan diisi lengkap!${RESET}"

echo -e "${YELLOW}🔥 Install PM2 buat ngejalanin bot 24/7...${RESET}"
sudo npm install -g pm2

echo -e "${CYAN}🚀 Menyalakan bot dengan PM2...${RESET}"
pm2 start app.js --name bot-keren
pm2 startup systemd -u $USER --hp $HOME
pm2 save

echo -e "${GREEN}✅ Bot lo udah jalan dan akan auto-nyala kalau VPS reboot!${RESET}"

echo -e "${CYAN}📦 Perintah berguna buat bot lo:${RESET}"
echo -e "${YELLOW}➡️ pm2 logs bot-keren        ${CYAN}# Lihat log${RESET}"
echo -e "${YELLOW}➡️ pm2 restart bot-keren     ${CYAN}# Restart bot${RESET}"
echo -e "${YELLOW}➡️ pm2 stop bot-keren        ${CYAN}# Stop bot${RESET}"
echo -e "${YELLOW}➡️ pm2 delete bot-keren      ${CYAN}# Hapus bot dari PM2${RESET}"

echo -e "${GREEN}✨ SEMUA BERES! Sekarang tinggal buka Telegram & coba /start 💬${RESET}"
