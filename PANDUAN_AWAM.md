# PANDUAN_AWAM — langkah klik demi klik (untuk non-teknis)

Aturan emas: **semua langkah di bawah memakai project UJI Supabase (`testmpo3`), BUKAN produksi.** Kalau ragu, berhenti dan kirim saya apa yang Anda lihat.
Yang **sudah saya kerjakan sendiri** (tidak perlu Anda ulangi): migrasi 008, 009 dan 010 sudah dipasang di `testmpo3` (**migrasi 011 — mode alif adaptif — BELUM dipasang**: jalankan `supabase/migrations/20261111000011_eas_v6_2_adaptive_mode.sql` sebelum membuat ruang bermode adaptif; aman diulang), dan pemeriksaan database (`roles_rls.sql`) sudah dijalankan di sana dan **lulus**.
Yang **belum bisa saya lakukan** dan perlu Anda: memasang fungsi server `eas-game` versi baru, memasang situs ke Vercel (pratinjau), dan mencoba di browser/HP sungguhan.

---

## Bagian A — Pasang fungsi server `eas-game` versi baru ke project uji

Tanpa ini, situs baru tidak bisa dimainkan online (server lama belum mengenal Judge/Spectator/3–4 pemain).

**Langkah A1. Siapkan alat (sekali saja)**
1. Pastikan komputer punya Node.js 20 atau lebih baru. Buka Terminal (Mac) / PowerShell (Windows), ketik `node -v` lalu Enter.
   - Berhasil: tampil `v20...` atau lebih tinggi. 
   - Gagal ("command not found"): pasang dari nodejs.org (tombol LTS), buka ulang Terminal, ulangi.
   - **Kirim ke saya:** tulisan yang muncul bila gagal.
2. Ketik `npm install -g supabase` lalu Enter. Tunggu selesai. Ketik `supabase --version`.
   - Berhasil: tampil nomor versi.

**Langkah A2. Masuk dan hubungkan ke project uji**
1. Ketik `supabase login` → browser terbuka → klik **Authorize**. Terminal menulis "You are now logged in".
2. Ekstrak zip proyek dari saya. Di Terminal masuk ke folder hasil ekstrak (folder yang berisi `index.html`): ketik `cd ` lalu seret folder itu ke jendela Terminal, Enter.
3. Ketik `supabase link --project-ref tcehtgfwcywfzzhehvrh` lalu Enter. Bila diminta kata sandi database, masukkan sandi yang Anda buat saat membuat project `testmpo3`.
   - Berhasil: "Finished supabase link".
   - Gagal "password": sandi salah. Supabase → project `testmpo3` → Project Settings → Database → **Reset database password**, lalu ulangi.

**Langkah A3. Pasang fungsi**
1. Ketik `supabase functions deploy eas-game` lalu Enter.
   - Berhasil: "Deployed Functions on project tcehtgfwcywfzzhehvrh: eas-game".
   - Gagal: salin seluruh teks merah dan kirim ke saya.
2. **Jangan** menjalankan `supabase db push` — migrasi sudah saya pasang. (Bila Anda jalankan dan muncul "already exists", itu aman; kirim saja teksnya.)

## Bagian B — Pasang situs pratinjau di Vercel (agar bisa dicoba di HP)

1. Buka vercel.com → project Anda → **Settings → Environment Variables**. Untuk lingkungan **Preview** isi dua variabel dengan nilai project UJI:
   - `SUPABASE_URL` = `https://tcehtgfwcywfzzhehvrh.supabase.co`
   - `SUPABASE_ANON_KEY` = kunci **anon / publishable** dari Supabase → `testmpo3` → Project Settings → API. **Jangan** pakai kunci `service_role`.
2. Di GitHub, buat **branch baru** bernama `v6-test` pada repo Anda, lalu **Add file → Upload files**: seret semua isi folder hasil ekstrak (isi di dalamnya, bukan foldernya), tulis pesan `v6 wip`, pilih **Commit directly to the v6-test branch**.
3. Kembali ke Vercel → **Deployments**. Tunggu ±1 menit sampai ada baris baru berstatus **Ready** untuk branch `v6-test`. Klik baris itu → **Visit**. Itu alamat pratinjau Anda.
   - Berhasil: halaman sampul game terbuka.
   - Gagal "Build Error": klik baris itu → salin 20 baris terakhir log, kirim ke saya.
4. Buka `<alamat-pratinjau>/pwa-check.html`. Semua baris harus bertanda ✓ (peringatan "not installed" boleh).
   - Ada ✗ pada "Supabase address/key" atau "eas-game": variabel Langkah B1 salah / fungsi A3 belum terpasang. Kirim foto layarnya.
5. Di Supabase → `testmpo3` → **Authentication → Sign In / Providers → Allow anonymous sign-ins** harus **ON**.

> Produksi tidak disentuh sama sekali. Branch `main` Anda tetap versi lama sampai Anda sendiri memutuskan menggabungkan.

## Bagian C — Uji manual (15 poin; pakai 2–4 perangkat/jendela privat)

Siapkan: 2 HP + 2 jendela privat laptop (A, B, C, D), ditambah satu orang untuk Judge dan satu untuk Penonton bila ada.
Tandai ✅ / ❌ dan kirim hasilnya (cukup nomor yang ❌ + foto layar).

1. **Dua pemain biasa** (online) dan **offline** (satu perangkat): berjalan seperti biasa, kartu "A vs B" tampil seperti dulu.
2. **Pengaturan**: buka ⚙. Tombol **ملء الشاشة (layar penuh)** ada paling atas; di bawahnya warna, tata letak, rak, jeda. "خيارات إضافية" tertutup sampai ditekan.
3. **Aturan**: tombol «قواعد اللعبة» membuka jendela besar yang mudah dibaca (di HP memenuhi lebar layar); tombol × menutupnya.
4. **Ruang slot**: buat ruang 4 pemain. Muncul **satu deret** kartu slot bernomor; slot kosong = tombol putus-putus "اجلس هنا". Di HP kedua, tekan slot kosong: kartunya pindah dan terlihat di HP pertama.
5. **Peran di lobi**: dari lobi, satu orang pindah ke «كن الحكم» dan satu ke «شاهد». Tuan rumah tidak bisa menjadi Judge/penonton (tombol mati).
6. **Mulai 3 pemain** (dari ruang 4 kursi, 3 terisi, ada celah): jalan. Strip pemain menampilkan **urutan hasil undian**; hanya rak Anda sendiri yang terlihat.
7. **Giliran** berputar mengikuti strip; yang bukan gilirannya tidak bisa Pass/Kirim.
8. **Menyerah di 3–4 pemain**: yang menyerah ditandai "خرج", permainan lanjut; muat ulang halamannya: ia tidak kembali bermain.
9. **Sengketa kata tanpa Judge**: keputusan jatuh bila **lebih dari separuh** pemain memilih sama; imbang = diskusi lanjut.
10. **Dengan Judge**: استدعاء الحكم → jam berhenti → Judge membuka tahkim dan memutuskan; pemain bisa سحب الاستدعاء; Judge bisa menjeda; tutup tab Judge >60 detik → pemain bisa melanjutkan.
11. **Penonton**: melihat papan dan skor, tanpa rak, tanpa tombol main/jeda, tanpa tab chat.
12. **Chat**: buka catatan (☰) → tab «الدردشة». Pesan muncul di pemain lain dan Judge; ada **angka di tab** dan **titik di tombol catatan**; pesan **tidak** muncul di daftar kata/keputusan; setelah muat ulang pesan Anda sendiri hilang.
13. **Mode mengambang** (⚙ → tata letak): strip pemain bisa **digeser dan diubah ukurannya**; posisinya diingat setelah muat ulang (juga di ruang 3–4 pemain).
14. **HP kecil (≤360px) dan HP miring**: papan, strip, rak, dan lobi terlihat tanpa geser ke samping.
15. **Rematch 3+ pemain**: semua menekan «إعادة المباراة» → ronde 2 mulai dengan **urutan baru**; pemain yang tidak mau rematch keluar, sisanya tetap bisa.

## Bagian D — Bila ada yang salah
Kirim ke saya: (1) nomor langkah/poin, (2) foto layar atau teks merah, (3) perangkat dan browser yang dipakai. Itu cukup.
