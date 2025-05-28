# DorXLHORE

## Deskripsi

DorXLHORE adalah sebuah bot Telegram yang dirancang untuk memfasilitasi proses verifikasi dan pembayaran menggunakan QRIS. Bot ini memungkinkan pengguna untuk meminta OTP, memverifikasi nomor telepon, dan melakukan pembayaran dengan QRIS.

## Fitur

- **Verifikasi Pengguna**: Pengguna dapat memverifikasi nomor telepon mereka dengan OTP.
- **Pembayaran QRIS**: Bot menyediakan QR code untuk pembayaran yang dapat dipindai oleh pengguna.
- **Notifikasi Pembayaran**: Pengguna akan menerima notifikasi setelah pembayaran berhasil.
- **Proses DOR**: Setelah pembayaran, bot akan memproses layanan DOR yang diminta.

## Instalasi

<details>
  <summary>Instalasi Otomatis</summary>

  Skrip ini akan menginstal Node.js (jika belum terinstal), menginstal dependensi, dan mengatur file `.env`.
  ```bash
  git clone https://github.com/AutoFTbot/DorXLHORE.git
  cd DorXLHORE/tele
  ```
  ```bash
  chmod +x setup.sh
  ./setup.sh
  ```
</details>

<details>
  <summary>Instalasi Manual</summary>

  1. **Clone repositori ini**:
     ```bash
     git clone https://github.com/AutoFTbot/DorXLHORE.git
     cd DorXLHORE/tele
     ```

  2. **Instalasi dependensi**:
     Pastikan Anda memiliki Node.js dan npm terinstal. Kemudian jalankan:
     ```bash
     npm install
     ```

  3. **Konfigurasi**:
     Salin file `.env.example` menjadi `.env` dan isi dengan informasi yang diperlukan seperti `BOT_TOKEN`, `ADMIN_ID`, `LOGGING_GROUP_ID`, dll.

  4. **Menjalankan Bot**:
     Jalankan perintah berikut untuk memulai bot:
     ```bash
     node app.js
     ```
</details>

## Penggunaan

- **Memulai Bot**: Gunakan perintah `/start` di Telegram untuk memulai interaksi dengan bot.
- **Meminta OTP**: Klik tombol "Minta OTP" untuk memulai proses verifikasi.
- **Pembayaran**: Setelah verifikasi, ikuti instruksi untuk melakukan pembayaran melalui QRIS.

## Kontribusi

Silakan fork proyek ini jika Anda ingin melakukan perubahan atau modifikasi. Jangan diperjualbelikan.

## Lisensi

Proyek ini dibuat oleh AutoFTbot pada 19 April 2025 dan dilarang keras untuk diperjualbelikan.
