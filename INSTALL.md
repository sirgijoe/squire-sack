# How to install Squire

Squire is free. Pick the way that fits you. You can start with **Option 1** and switch later; a backup (*More → Backup*) moves everything from one to the other.

- [Option 1: Use it in your web browser (any phone, tablet or computer)](#option-1-use-it-in-your-web-browser)
- [Option 2: Install the app](#option-2-install-the-app)
  - [Windows](#windows) · [Mac](#mac) · [Android](#android) · [Linux](#linux) · [iPhone / iPad](#iphone--ipad)
- [Sync your phone with your computer](#sync-your-phone-with-your-computer)
- [Keep your Sack safe](#keep-your-sack-safe)
- [Something not working?](#something-not-working)

---

## Option 1: Use it in your web browser

Nothing to download, and it works offline once it has loaded.

1. Open **https://sirgijoe.github.io/squire-sack/**
2. Put it on your home screen so it opens like an app:
   - **iPhone / iPad (Safari):** tap the **Share** button (the square with an arrow), then **Add to Home Screen**, then **Add**.
   - **Android (Chrome):** tap **⋮** (top right), then **Install app** or **Add to Home screen**.
   - **Computer (Chrome or Edge):** click the install icon at the right end of the address bar, or **⋮ → Install Squire**.

Your Sack is saved on that device, inside that browser.

---

## Option 2: Install the app

Go to the **[latest release](https://github.com/sirgijoe/squire-sack/releases/latest)**, scroll down to **Assets**, and download the file for your device.

### Windows

1. Download **`Squire_…_x64-setup.exe`**.
2. Open it. If Windows says **"Windows protected your PC"**, click **More info**, then **Run anyway**.
   *(This shows up because Squire isn't code-signed. Signing costs money every year, and Squire is free.)*
3. Click through the installer. Squire appears in your Start menu.

### Mac

1. Find out which chip your Mac has: click the **Apple menu** → **About This Mac**.
   - **Chip: Apple M1, M2, M3…** → download **`Squire_…_aarch64.dmg`**
   - **Processor: Intel** → download **`Squire_…_x64.dmg`**
2. Open the downloaded file and drag **Squire** onto the **Applications** folder.
3. Open Squire from Applications. macOS will say it can't check the app. Click **Done**.
4. Open **System Settings → Privacy & Security**, scroll down to **Security**, and click **Open Anyway** next to Squire. Enter your password if asked.
   *(You only do this once. The button disappears after about an hour, so do it right after step 3.)*
5. If macOS says Squire **"is damaged and can't be opened"**, open **Terminal** and paste this, then press Return:
   ```
   xattr -dr com.apple.quarantine /Applications/Squire.app
   ```

### Android

1. On your phone, download **`Squire_…_android.apk`**.
2. Tap it to open. If Android asks, allow your browser to **install unknown apps**, then tap **Install**.
3. Open Squire from your app list.

### Linux

- **AppImage:** download **`Squire_…_amd64.AppImage`**, right-click it, choose **Properties → Allow executing as a program** (or run `chmod +x Squire_*.AppImage`), then double-click it.
- **Debian / Ubuntu:** download the **`.deb`** and open it with your software installer, or run `sudo apt install ./Squire_*.deb`.
- **Fedora:** download the **`.rpm`** and run `sudo dnf install ./Squire-*.rpm`.

### iPhone / iPad

There's no App Store version yet. Use **[Option 1](#option-1-use-it-in-your-web-browser)** and add Squire to your home screen. It works offline and keeps your Sack on your phone.

---

## Sync your phone with your computer

Your computer can be the **home base** for your Sack. Phones on the same Wi-Fi sync with it, and full-size photos move to the computer so your phone keeps only small copies.

**This works with the Squire app on Windows, Mac or Linux, plus the Android app.** iPhone sync isn't ready yet.

1. **On the computer:** open Squire → **More** → **Set up home base** → **Start the home base**.
   If your computer asks whether Squire can accept network connections, choose **Allow** (private/home networks).
2. Click **Pair a phone**. A QR code and a 6-digit code appear.
3. **On the phone:** open Squire → **More** → **Pair with home base**. Tap **Scan the code on the computer** if you see it, or type in the address and 6-digit code shown on the computer.
4. Done. The phone syncs whenever the computer's Squire is open on the same Wi-Fi. You can also tap **Sync now** anytime.

Good to know:
- The computer doesn't have to stay on. The phone keeps working and catches up the next time the computer is awake.
- To keep full-size photos on the phone too, turn off **Move full-size photos to the home base** in the phone's sync settings.

---

## Keep your Sack safe

Your Sack lives on your own devices. Nothing goes to the cloud, so **make a backup now and then**:

**More → Backup → Make a backup.** Save the `.zip` somewhere other than that device, such as a USB stick, another computer, or cloud storage you trust.

To bring it back, or to move to another device: **More → Backup → Restore from backup**.

---

## Something not working?

[Open an issue](https://github.com/sirgijoe/squire-sack/issues/new/choose) and tell us your device, what you tried, and what happened. A screenshot helps.
