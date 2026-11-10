# คู่มือการติดตั้ง เหมียวเตือนเวร บน Vercel + Turso (ฟรี 100%)

เวอร์ชันนี้ถูกปรับโครงสร้างให้ทำงานบน **Vercel Serverless Architecture** โดยเก็บข้อมูลบน **Turso (Serverless SQLite)** และใช้ **cron-job.org** เป็นตัวกระตุ้นการแจ้งเตือน ทุกบริการใช้ **Free Tier 100% ไม่เสียค่าบริการ**

---

## องค์ประกอบของระบบ

1. **Vercel:** ทำหน้าที่เป็น Serverless Function รับข้อความจาก LINE Webhook (`/webhook`) และประมวลผลคำสั่ง
2. **Turso (libSQL):** ฐานข้อมูล SQLite บน Cloud ที่มีแพ็กเกจฟรี (พื้นที่ 9 GB, อ่านข้อมูลได้ 1,000 ล้านครั้ง/เดือน) รองรับ Multi-user แยกข้อมูลชัดเจน
3. **cron-job.org:** บริการฟรีสำหรับส่งสัญญาณสะกิด Endpoint (`/tick`) ทุก ๆ 1 นาที เพื่อตรวจคิวแจ้งเตือนเวรและส่ง Push Notification

---

## ขั้นตอนการติดตั้งทีละสเต็ป

### ขั้นตอนที่ 1: เตรียมฐานข้อมูล Turso (ใช้เวลา 2 นาที)

1. ไปที่เว็บไซต์ [Turso.tech](https://turso.tech/) แล้วสมัคร/เข้าสู่ระบบด้วย GitHub
2. กด **Create Database**
   * ตั้งชื่อฐานข้อมูล เช่น `nurse-line-bot`
   * เลือก Region ที่ใกล้ไทยที่สุด เช่น `Singapore (sin)` หรือ `Tokyo (nrt)`
3. เมื่อสร้างเสร็จ คุณจะได้รับ:
   * **Database URL** เช่น `libsql://nurse-line-bot-username.turso.io`
4. ไปที่แท็บ **Tokens** หรือกด **Generate Token** เพื่อสร้าง Auth Token
   * คัดลอก **Auth Token** ยาว ๆ เก็บไว้

---

### ขั้นตอนที่ 2: นำโค้ดขึ้น GitHub และ Deploy บน Vercel (ใช้เวลา 3 นาที)

1. นำไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้น **GitHub Repository** ส่วนตัวของคุณ (เช่น `nurse-line-bot-vercel`)
2. ไปที่ [Vercel.com](https://vercel.com/) ล็อกอินด้วย GitHub
3. กด **Add New...** > **Project** แล้วเลือก Repository ที่เพิ่งอัปโหลด
4. ในหน้า Configure Project ก่อนกด Deploy ให้เปิดหัวข้อ **Environment Variables** แล้วใส่ตัวแปรดังนี้:

| Key (ชื่อตัวแปร) | Value (ค่าที่ต้องกรอก) | ที่มา |
| :--- | :--- | :--- |
| `LINE_CHANNEL_SECRET` | Secret 32 ตัวอักษร | LINE Developers > Basic settings |
| `LINE_CHANNEL_ACCESS_TOKEN` | Token ยาว ๆ | LINE Developers > Messaging API |
| `LINE_OWNER_USER_ID` | Your user ID (ขึ้นต้นด้วย U...) | LINE Developers > Messaging API |
| `TURSO_DATABASE_URL` | URL ของ Turso (ขึ้นต้นด้วย `libsql://...`) | จากขั้นตอนที่ 1 |
| `TURSO_AUTH_TOKEN` | Token ของ Turso | จากขั้นตอนที่ 1 |
| `CRON_SECRET` *(ทางเลือก)* | รหัสสุ่มที่คุณตั้งเอง เช่น `my_secret_token_123` | ใช้สำหรับป้องกันคนอื่นยิง endpoint /tick |

5. กดปุ่ม **Deploy** แล้วรอประมาณ 30–60 วินาที
6. เมื่อ Deploy สำเร็จ คุณจะได้ URL ของโปรเจกต์ เช่น `https://nurse-line-bot-xxxx.vercel.app`

---

### ขั้นตอนที่ 3: ตั้งค่า Webhook ใน LINE Developers

1. เข้าไปที่ [LINE Developers Console](https://developers.line.biz/console/) เลือก Provider และ Channel ของคุณ
2. ไปที่แท็บ **Messaging API**
3. ที่หัวข้อ **Webhook settings**:
   * **Webhook URL:** ใส่ URL ของ Vercel แล้วเติม `/webhook` ต่อท้าย เช่น:
     `https://nurse-line-bot-xxxx.vercel.app/webhook`
   * กดปุ่ม **Update**
   * กดปุ่ม **Verify** (ต้องขึ้นสถานะ Success)
   * เปิดสวิตช์ **Use webhook** เป็นสีเขียว (Enabled)
4. ปิด Auto-reply messages ของ LINE Official Account เพื่อไม่ให้ตอบข้อความทับซ้อนกับบอต

---

### ขั้นตอนที่ 4: ตั้งค่าตัวสะกิดเตือนเวรบน cron-job.org (ฟรี 100%)

เพื่อให้บอตสามารถส่งข้อความเตือนก่อนขึ้นเวรได้ตรงเวลาแม้ไม่มีใครส่งแชตเข้ามา:

1. สมัครใช้งานฟรีที่ [cron-job.org](https://cron-job.org/)
2. กด **CREATE CRONJOB**
   * **Title:** `Nurse Bot Reminder`
   * **URL:** ใส่ URL ของ Vercel แล้วเติม `/tick` ต่อท้าย เช่น:
     * หากไม่ได้ตั้ง `CRON_SECRET`: `https://nurse-line-bot-xxxx.vercel.app/tick`
     * หากตั้ง `CRON_SECRET`: `https://nurse-line-bot-xxxx.vercel.app/tick?secret=my_secret_token_123`
   * **Schedule:** เลือก **Every 1 minute** (ทำงานทุก 1 นาที)
   * **Notifications:** เลือกแจ้งเตือนเมื่อเกิด Error เท่านั้น หรือปิดไว้
3. กด **Create**

---

## ทดสอบการใช้งานใน LINE

1. เพิ่มเพื่อน LINE OA ของคุณ
2. พิมพ์คำว่า **เมนู**
3. ระบบจะตอบกลับด้วยการ์ด 3 ปุ่ม: **เวรวันนี้**, **ตารางของฉัน**, **ตั้งค่า**
4. เข้าไปที่ **ตั้งค่า** > ตรวจสอบเวลาเวร แล้วกดยืนยันเวลา
5. ลงเวรใน **ตารางของฉัน** แล้วเปิดการแจ้งเตือน
6. ทุกอย่างพร้อมทำงานอัตโนมัติ 24 ชั่วโมง โดยไม่มีค่าใช้จ่ายรายเดือนครับ!
