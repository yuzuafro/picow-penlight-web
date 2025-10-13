class PenlightController {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.colorCharacteristic = null;
        this.controlCharacteristic = null;
        this.isConnected = false;
        this.isAutoMode = false;

        // UUIDs (Pico側と一致させる)
        this.SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
        this.COLOR_CHAR_UUID = '12345678-1234-1234-1234-123456789abd';
        this.CONTROL_CHAR_UUID = '12345678-1234-1234-1234-123456789abe';

        this.initializeElements();
        this.bindEvents();
        this.checkBluetoothSupport();
    }

    initializeElements() {
        // UI要素の取得
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.controlSection = document.getElementById('controlSection');

        // モード制御
        this.colorModeBtn = document.getElementById('colorModeBtn');
        this.autoModeBtn = document.getElementById('autoModeBtn');
        this.colorMode = document.getElementById('colorMode');
        this.autoMode = document.getElementById('autoMode');

        // 色選択
        this.colorPicker = document.getElementById('colorPicker');
        this.colorValue = document.getElementById('colorValue');
        this.colorPreview = document.getElementById('colorPreview');
        this.applyColorBtn = document.getElementById('applyColorBtn');

        // プリセット色
        this.presetColors = document.querySelectorAll('.preset-color');

        // 自動制御
        this.patternRadios = document.querySelectorAll('input[name="pattern"]');
        this.startAutoBtn = document.getElementById('startAutoBtn');
        this.stopAutoBtn = document.getElementById('stopAutoBtn');

        // 共通コントロール
        this.clearBtn = document.getElementById('clearBtn');

        // 初期色の設定
        this.updateColorPreview(this.colorPicker.value);
    }

    bindEvents() {
        // 接続制御
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());

        // モード切り替え
        this.colorModeBtn.addEventListener('click', () => this.switchToColorMode());
        this.autoModeBtn.addEventListener('click', () => this.switchToAutoMode());

        // 色選択
        this.colorPicker.addEventListener('input', (e) => this.updateColorPreview(e.target.value));
        this.applyColorBtn.addEventListener('click', () => this.applyColor());

        // プリセット色
        this.presetColors.forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;
                this.colorPicker.value = color;
                this.updateColorPreview(color);
                this.applyColor();
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
            this.showStatus('接続中...', false);
            this.connectBtn.classList.add('loading');

            // デバイスの検索
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ name: 'Penlight' }],
                optionalServices: [this.SERVICE_UUID]
            });

            console.log('デバイスが選択されました:', this.device.name);

            // 切断イベントの監視
            this.device.addEventListener('gattserverdisconnected', () => {
                this.onDisconnected();
            });

            // GATTサーバーに接続
            this.server = await this.device.gatt.connect();
            console.log('GATTサーバーに接続しました');

            // サービスの取得
            this.service = await this.server.getPrimaryService(this.SERVICE_UUID);
            console.log('サービスを取得しました');

            // キャラクタリスティックの取得
            this.colorCharacteristic = await this.service.getCharacteristic(this.COLOR_CHAR_UUID);
            this.controlCharacteristic = await this.service.getCharacteristic(this.CONTROL_CHAR_UUID);

            console.log('キャラクタリスティックを取得しました');

            this.onConnected();
        } catch (error) {
            console.error('接続エラー:', error);
            this.showError(`接続に失敗しました: ${error.message}`);
            this.onDisconnected();
        } finally {
            this.connectBtn.classList.remove('loading');
        }
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

    // 色プレビューの更新
    updateColorPreview(hexColor) {
        this.colorValue.textContent = hexColor.toUpperCase();
        this.colorPreview.style.backgroundColor = hexColor;
    }

    // 色の適用
    async applyColor() {
        if (!this.isConnected) {
            this.showError('ペンライトに接続してください');
            return;
        }

        try {
            const rgb = this.hexToRgb(this.colorPicker.value);
            await this.sendColor(rgb.r, rgb.g, rgb.b);
            console.log(`色を適用しました: RGB(${rgb.r}, ${rgb.g}, ${rgb.b})`);
        } catch (error) {
            console.error('色の送信エラー:', error);
            this.showError('色の送信に失敗しました');
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
}

// アプリケーションの初期化
document.addEventListener('DOMContentLoaded', () => {
    new PenlightController();
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