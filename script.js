class ColorlightController {
    constructor() {
        // 複数デバイス管理
        this.devices = new Map(); // デバイスID -> デバイス情報のマップ
        this.deviceGroups = new Map(); // デバイスID -> グループ名のマップ

        // UUIDs (Pico側と一致させる)
        this.SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
        this.COLOR_CHAR_UUID = '12345678-1234-1234-1234-123456789abd';
        this.CONTROL_CHAR_UUID = '12345678-1234-1234-1234-123456789abe';

        // 制御対象
        this.controlTarget = 'all'; // 'all', 'group', 'individual'
        this.selectedGroup = null;
        this.selectedDevice = null;

        // デバウンス用のタイマー
        this.colorSendTimer = null;
        this.colorSendDelay = 100; // 100msのデバウンス

        this.initializeElements();
        this.bindEvents();
        this.checkBluetoothSupport();
    }

    initializeElements() {
        // UI要素の取得
        this.connectedCount = document.getElementById('connectedCount');
        this.connectBtn = document.getElementById('connectBtn');
        this.devicesSection = document.getElementById('devicesSection');
        this.devicesList = document.getElementById('devicesList');
        this.controlSection = document.getElementById('controlSection');

        // 制御対象選択
        this.targetAllBtn = document.getElementById('targetAllBtn');
        this.targetGroupBtn = document.getElementById('targetGroupBtn');
        this.targetIndividualBtn = document.getElementById('targetIndividualBtn');
        this.groupSelection = document.getElementById('groupSelection');
        this.individualSelection = document.getElementById('individualSelection');
        this.groupButtons = document.getElementById('groupButtons');
        this.individualButtons = document.getElementById('individualButtons');

        // モード制御
        this.colorModeBtn = document.getElementById('colorModeBtn');
        this.autoModeBtn = document.getElementById('autoModeBtn');
        this.colorMode = document.getElementById('colorMode');
        this.autoMode = document.getElementById('autoMode');

        // カスタムカラースライダー
        this.hueSlider = document.getElementById('hueSlider');
        this.hueValue = document.getElementById('hueValue');
        this.saturationValue = document.getElementById('saturationValue');
        this.lightnessValue = document.getElementById('lightnessValue');
        this.colorValue = document.getElementById('colorValue');
        this.colorPreview = document.getElementById('colorPreview');

        // 2Dカラーピッカー
        this.colorPicker2D = document.getElementById('colorPicker2D');
        this.colorPickerCursor = document.getElementById('colorPickerCursor');
        this.colorPicker2DContext = this.colorPicker2D.getContext('2d');
        this.isDragging = false;

        // 現在のHSL値
        this.currentHue = 0;
        this.currentSaturation = 100;
        this.currentLightness = 50;

        // プリセット色
        this.presetColors = document.querySelectorAll('.preset-color');

        // 自動制御
        this.patternRadios = document.querySelectorAll('input[name="pattern"]');
        this.startAutoBtn = document.getElementById('startAutoBtn');
        this.stopAutoBtn = document.getElementById('stopAutoBtn');

        // 共通コントロール
        this.clearBtn = document.getElementById('clearBtn');

        // 初期色の設定と2Dピッカーの描画
        this.draw2DColorPicker();
        this.updateColorDisplay();
        this.updateCursorPosition();
    }

    bindEvents() {
        // 接続制御
        this.connectBtn.addEventListener('click', () => this.connect());

        // 制御対象切り替え
        this.targetAllBtn.addEventListener('click', () => this.switchControlTarget('all'));
        this.targetGroupBtn.addEventListener('click', () => this.switchControlTarget('group'));
        this.targetIndividualBtn.addEventListener('click', () => this.switchControlTarget('individual'));

        // グループ選択
        this.groupButtons.querySelectorAll('.btn-group').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedGroup = btn.dataset.group;
                this.updateGroupButtons();
            });
        });

        // モード切り替え
        this.colorModeBtn.addEventListener('click', () => this.switchToColorMode());
        this.autoModeBtn.addEventListener('click', () => this.switchToAutoMode());

        // 色相スライダー（デバウンスで反映）
        this.hueSlider.addEventListener('input', () => {
            this.currentHue = parseInt(this.hueSlider.value);
            this.draw2DColorPicker();
            this.updateColorDisplay();
            if (this.isConnected) {
                this.debouncedApplyColor();
            }
        });

        // 2Dカラーピッカーのイベント
        this.colorPicker2D.addEventListener('mousedown', (e) => this.startPicking(e));
        this.colorPicker2D.addEventListener('mousemove', (e) => this.continuePicking(e));
        this.colorPicker2D.addEventListener('mouseup', () => this.stopPicking());
        this.colorPicker2D.addEventListener('mouseleave', () => this.stopPicking());

        // タッチイベント対応
        this.colorPicker2D.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startPicking(e.touches[0]);
        });
        this.colorPicker2D.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.continuePicking(e.touches[0]);
        });
        this.colorPicker2D.addEventListener('touchend', () => this.stopPicking());

        // プリセット色
        this.presetColors.forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;
                this.setColorFromHex(color);
                if (this.isConnected) {
                    this.applyCurrentColor();
                }
            });
        });

        // 自動制御
        this.startAutoBtn.addEventListener('click', () => this.startAutoMode());
        this.stopAutoBtn.addEventListener('click', () => this.stopAutoMode());

        // 共通コントロール
        this.clearBtn.addEventListener('click', () => this.clearLeds());
    }

    checkBluetoothSupport() {
        if (!navigator.bluetooth) {
            this.showError('このブラウザはWeb Bluetooth APIをサポートしていません。Chrome、Edge、またはOperaをお使いください。');
            this.connectBtn.disabled = true;
        }
    }

    async connect() {
        try {
            this.connectBtn.classList.add('loading');

            // デバイスの検索（Colorlight-で始まる全デバイス）
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Colorlight-' }],
                optionalServices: [this.SERVICE_UUID]
            });

            console.log('デバイスが選択されました:', device.name);

            // 既に接続されているかチェック
            const deviceId = this.extractDeviceId(device.name);
            if (this.devices.has(deviceId)) {
                this.showError('このデバイスは既に接続されています');
                return;
            }

            // 切断イベントの監視
            device.addEventListener('gattserverdisconnected', () => {
                this.onDeviceDisconnected(deviceId);
            });

            // GATTサーバーに接続
            const server = await device.gatt.connect();
            console.log('GATTサーバーに接続しました');

            // サービスの取得
            const service = await server.getPrimaryService(this.SERVICE_UUID);
            console.log('サービスを取得しました');

            // キャラクタリスティックの取得
            const colorCharacteristic = await service.getCharacteristic(this.COLOR_CHAR_UUID);
            const controlCharacteristic = await service.getCharacteristic(this.CONTROL_CHAR_UUID);

            console.log('キャラクタリスティックを取得しました');

            // デバイス情報を保存
            this.devices.set(deviceId, {
                id: deviceId,
                name: device.name,
                device: device,
                server: server,
                service: service,
                colorCharacteristic: colorCharacteristic,
                controlCharacteristic: controlCharacteristic,
                isConnected: true,
                isAutoMode: false
            });

            this.onDeviceConnected(deviceId);
        } catch (error) {
            console.error('接続エラー:', error);
            if (error.name !== 'NotFoundError') {
                this.showError(`接続に失敗しました: ${error.message}`);
            }
        } finally {
            this.connectBtn.classList.remove('loading');
        }
    }

    extractDeviceId(deviceName) {
        // "Colorlight-1" から "1" を抽出
        const match = deviceName.match(/Colorlight-(\d+)/);
        return match ? match[1] : deviceName;
    }

    async disconnect() {
        try {
            if (this.device && this.device.gatt.connected) {
                await this.device.gatt.disconnect();
            }
        } catch (error) {
            console.error('切断エラー:', error);
        }
        this.onDisconnected();
    }

    onConnected() {
        this.isConnected = true;
        this.showStatus('接続済み', true);
        this.connectBtn.style.display = 'none';
        this.disconnectBtn.style.display = 'inline-block';
        this.controlSection.style.display = 'block';
        this.controlSection.classList.add('fade-in');
        console.log('ペンライトに接続しました');
    }

    onDisconnected() {
        this.isConnected = false;
        this.isAutoMode = false;
        this.device = null;
        this.server = null;
        this.service = null;
        this.colorCharacteristic = null;
        this.controlCharacteristic = null;

        this.showStatus('未接続', false);
        this.connectBtn.style.display = 'inline-block';
        this.disconnectBtn.style.display = 'none';
        this.controlSection.style.display = 'none';

        // 自動制御ボタンのリセット
        this.startAutoBtn.style.display = 'inline-block';
        this.stopAutoBtn.style.display = 'none';

        console.log('ペンライトから切断しました');
    }

    showStatus(text, connected) {
        this.statusText.textContent = text;
        if (connected) {
            this.statusDot.classList.add('connected');
        } else {
            this.statusDot.classList.remove('connected');
        }
    }

    showError(message) {
        alert(message);
    }

    // 色選択モードに切り替え
    switchToColorMode() {
        if (this.isAutoMode) {
            this.stopAutoMode();
        }
        this.colorModeBtn.classList.add('active');
        this.autoModeBtn.classList.remove('active');
        this.colorMode.style.display = 'block';
        this.autoMode.style.display = 'none';
    }

    // 自動制御モードに切り替え
    switchToAutoMode() {
        this.autoModeBtn.classList.add('active');
        this.colorModeBtn.classList.remove('active');
        this.autoMode.style.display = 'block';
        this.colorMode.style.display = 'none';
    }

    // 2Dカラーピッカーを描画
    draw2DColorPicker() {
        const canvas = this.colorPicker2D;
        const ctx = this.colorPicker2DContext;
        const width = canvas.width;
        const height = canvas.height;

        // ベースカラー（現在の色相で彩度100%、明度50%）を塗りつぶす
        const baseColor = this.hslToRgb(this.currentHue, 100, 50);
        ctx.fillStyle = `rgb(${baseColor.r}, ${baseColor.g}, ${baseColor.b})`;
        ctx.fillRect(0, 0, width, height);

        // 横方向グラデーション：彩度（左：白、右：透明）
        const saturationGradient = ctx.createLinearGradient(0, 0, width, 0);
        saturationGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        saturationGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = saturationGradient;
        ctx.fillRect(0, 0, width, height);

        // 縦方向グラデーション：明度（上：透明、下：黒）
        const lightnessGradient = ctx.createLinearGradient(0, 0, 0, height);
        lightnessGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        lightnessGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
        ctx.fillStyle = lightnessGradient;
        ctx.fillRect(0, 0, width, height);
    }

    // カラー表示を更新
    updateColorDisplay() {
        // 表示値を更新
        this.hueValue.textContent = `${this.currentHue}°`;
        this.saturationValue.textContent = `${Math.round(this.currentSaturation)}%`;
        this.lightnessValue.textContent = `${Math.round(this.currentLightness)}%`;

        // HSLからRGBに変換
        const rgb = this.hslToRgb(this.currentHue, this.currentSaturation, this.currentLightness);
        const hexColor = this.rgbToHex(rgb.r, rgb.g, rgb.b);

        // プレビューを更新
        this.colorValue.textContent = hexColor.toUpperCase();
        this.colorPreview.style.backgroundColor = hexColor;
    }

    // カーソル位置を更新
    updateCursorPosition() {
        const canvas = this.colorPicker2D;
        const rect = canvas.getBoundingClientRect();

        const x = (this.currentSaturation / 100) * canvas.width;
        const y = (1 - this.currentLightness / 100) * canvas.height;

        // Canvas座標から画面座標に変換
        const screenX = rect.left + (x / canvas.width) * rect.width;
        const screenY = rect.top + (y / canvas.height) * rect.height;

        this.colorPickerCursor.style.left = `${screenX}px`;
        this.colorPickerCursor.style.top = `${screenY}px`;
    }

    // 2Dピッカーでの選択開始
    startPicking(event) {
        this.isDragging = true;
        this.pickColor(event);
    }

    // 2Dピッカーでの選択継続
    continuePicking(event) {
        if (this.isDragging) {
            this.pickColor(event);
        }
    }

    // 2Dピッカーでの選択終了
    stopPicking() {
        this.isDragging = false;
    }

    // 2Dピッカーから色を選択
    pickColor(event) {
        const canvas = this.colorPicker2D;
        const rect = canvas.getBoundingClientRect();

        // クリック位置を取得
        let clientX, clientY;
        if (event.touches) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }

        // Canvas内の相対位置を計算
        let x = clientX - rect.left;
        let y = clientY - rect.top;

        // 範囲制限
        x = Math.max(0, Math.min(x, rect.width));
        y = Math.max(0, Math.min(y, rect.height));

        // 彩度と明度を計算
        this.currentSaturation = (x / rect.width) * 100;
        this.currentLightness = 100 - (y / rect.height) * 100;

        // 表示を更新
        this.updateColorDisplay();
        this.updateCursorPosition();

        // Bluetooth送信（デバウンス）
        if (this.isConnected) {
            this.debouncedApplyColor();
        }
    }

    // Hex色から設定
    setColorFromHex(hexColor) {
        const rgb = this.hexToRgb(hexColor);
        if (!rgb) return;

        const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);

        this.currentHue = Math.round(hsl.h);
        this.currentSaturation = Math.round(hsl.s);
        this.currentLightness = Math.round(hsl.l);

        this.hueSlider.value = this.currentHue;
        this.draw2DColorPicker();
        this.updateColorDisplay();
        this.updateCursorPosition();
    }

    // 色適用（デバウンス付き）
    debouncedApplyColor() {
        // 既存のタイマーをクリア
        if (this.colorSendTimer) {
            clearTimeout(this.colorSendTimer);
        }

        // 新しいタイマーを設定
        this.colorSendTimer = setTimeout(() => {
            this.applyCurrentColor();
        }, this.colorSendDelay);
    }

    // 現在の色を適用
    async applyCurrentColor() {
        if (!this.isConnected) {
            this.showError('ペンライトに接続してください');
            return;
        }

        try {
            const rgb = this.hslToRgb(this.currentHue, this.currentSaturation, this.currentLightness);
            await this.sendColor(rgb.r, rgb.g, rgb.b);
            console.log(`色を適用しました: RGB(${rgb.r}, ${rgb.g}, ${rgb.b})`);
        } catch (error) {
            console.error('色の送信エラー:', error);
            // エラーメッセージは表示しない（連続送信時にアラートが煩わしいため）
            console.warn('色の送信に失敗しましたが、次の送信を試みます');
        }
    }

    // 自動制御開始
    async startAutoMode() {
        if (!this.isConnected) {
            this.showError('ペンライトに接続してください');
            return;
        }

        try {
            const selectedPattern = document.querySelector('input[name="pattern"]:checked').value;
            await this.sendCommand(`AUTO:${selectedPattern}`);

            this.isAutoMode = true;
            this.startAutoBtn.style.display = 'none';
            this.stopAutoBtn.style.display = 'inline-block';

            console.log(`自動制御を開始しました (パターン${selectedPattern})`);
        } catch (error) {
            console.error('自動制御開始エラー:', error);
            this.showError('自動制御の開始に失敗しました');
        }
    }

    // 自動制御停止
    async stopAutoMode() {
        if (!this.isConnected) return;

        try {
            await this.sendCommand('STOP');

            this.isAutoMode = false;
            this.stopAutoBtn.style.display = 'none';
            this.startAutoBtn.style.display = 'inline-block';

            console.log('自動制御を停止しました');
        } catch (error) {
            console.error('自動制御停止エラー:', error);
            this.showError('自動制御の停止に失敗しました');
        }
    }

    // 全消灯
    async clearLeds() {
        if (!this.isConnected) {
            this.showError('ペンライトに接続してください');
            return;
        }

        try {
            if (this.isAutoMode) {
                await this.stopAutoMode();
            }
            await this.sendCommand('CLEAR');
            console.log('LEDを消灯しました');
        } catch (error) {
            console.error('消灯エラー:', error);
            this.showError('消灯に失敗しました');
        }
    }

    // 色データの送信
    async sendColor(r, g, b) {
        if (!this.colorCharacteristic) {
            throw new Error('色制御キャラクタリスティックが利用できません');
        }

        const colorData = new Uint8Array([r, g, b]);
        await this.colorCharacteristic.writeValue(colorData);
    }

    // コマンドの送信
    async sendCommand(command) {
        if (!this.controlCharacteristic) {
            throw new Error('制御キャラクタリスティックが利用できません');
        }

        const encoder = new TextEncoder();
        const commandData = encoder.encode(command);
        await this.controlCharacteristic.writeValue(commandData);
    }

    // Hex色をRGBに変換
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    // RGBをHex色に変換
    rgbToHex(r, g, b) {
        const toHex = (n) => {
            const hex = Math.round(n).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    // HSL(H: 0-360, S: 0-100, L: 0-100)をRGB(0-255)に変換
    hslToRgb(h, s, l) {
        h = h / 360;
        s = s / 100;
        l = l / 100;

        let r, g, b;

        if (s === 0) {
            r = g = b = l; // 彩度0の場合はグレースケール
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;

            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }

    // RGB(0-255)をHSL(H: 0-360, S: 0-100, L: 0-100)に変換
    rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0; // 無彩色
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }

        return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            l: Math.round(l * 100)
        };
    }
}

// アプリケーションの初期化
document.addEventListener('DOMContentLoaded', () => {
    new ColorlightController();
});

// サービスワーカーの登録（PWA対応）
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered:', registration);
        } catch (error) {
            console.log('Service Worker registration failed:', error);
        }
    });
}