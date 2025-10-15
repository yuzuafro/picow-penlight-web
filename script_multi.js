class MultiPenlightController {
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

        // 現在のHSL値
        this.currentHue = 0;
        this.currentSaturation = 100;
        this.currentLightness = 50;

        this.initializeElements();
        this.bindEvents();
        this.checkBluetoothSupport();
    }

    initializeElements() {
        // 接続管理
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

        // カラーピッカー
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

        // プリセット色
        this.presetColors = document.querySelectorAll('.preset-color');

        // 自動制御
        this.patternRadios = document.querySelectorAll('input[name="pattern"]');
        this.startAutoBtn = document.getElementById('startAutoBtn');
        this.stopAutoBtn = document.getElementById('stopAutoBtn');

        // 共通コントロール
        this.clearBtn = document.getElementById('clearBtn');

        // 初期化
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

        // 色相スライダー
        this.hueSlider.addEventListener('input', () => {
            this.currentHue = parseInt(this.hueSlider.value);
            this.draw2DColorPicker();
            this.updateColorDisplay();
            this.debouncedApplyColor();
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
                this.applyCurrentColor();
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

    // === デバイス接続管理 ===

    async connect() {
        try {
            this.connectBtn.classList.add('loading');

            // デバイスの検索
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Penlight-' }],
                optionalServices: [this.SERVICE_UUID]
            });

            const deviceId = this.extractDeviceId(device.name);

            // 既に接続されているかチェック
            if (this.devices.has(deviceId)) {
                this.showError('このデバイスは既に接続されています');
                return;
            }

            console.log('デバイスが選択されました:', device.name);

            // 切断イベントの監視
            device.addEventListener('gattserverdisconnected', () => {
                this.onDeviceDisconnected(deviceId);
            });

            // GATTサーバーに接続
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(this.SERVICE_UUID);
            const colorCharacteristic = await service.getCharacteristic(this.COLOR_CHAR_UUID);
            const controlCharacteristic = await service.getCharacteristic(this.CONTROL_CHAR_UUID);

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
            console.log(`デバイス ${device.name} に接続しました`);
        } catch (error) {
            console.error('接続エラー:', error);
            if (error.name !== 'NotFoundError') {
                this.showError(`接続に失敗しました: ${error.message}`);
            }
        } finally {
            this.connectBtn.classList.remove('loading');
        }
    }

    async disconnectDevice(deviceId) {
        const deviceInfo = this.devices.get(deviceId);
        if (deviceInfo && deviceInfo.device.gatt.connected) {
            await deviceInfo.device.gatt.disconnect();
        }
        this.devices.delete(deviceId);
        this.deviceGroups.delete(deviceId);
        this.updateDevicesList();
        this.updateConnectedCount();
        this.updateIndividualButtons();
    }

    extractDeviceId(deviceName) {
        const match = deviceName.match(/Penlight-(\d+)/);
        return match ? match[1] : deviceName;
    }

    onDeviceConnected(deviceId) {
        this.updateDevicesList();
        this.updateConnectedCount();
        this.updateIndividualButtons();

        // コントロールセクションを表示
        if (this.devices.size > 0) {
            this.devicesSection.style.display = 'block';
            this.controlSection.style.display = 'block';
        }
    }

    onDeviceDisconnected(deviceId) {
        console.log(`デバイス ${deviceId} が切断されました`);
        this.devices.delete(deviceId);
        this.deviceGroups.delete(deviceId);
        this.updateDevicesList();
        this.updateConnectedCount();
        this.updateIndividualButtons();

        // デバイスがなくなったらコントロールを非表示
        if (this.devices.size === 0) {
            this.devicesSection.style.display = 'none';
            this.controlSection.style.display = 'none';
        }
    }

    // === UI更新 ===

    updateConnectedCount() {
        this.connectedCount.textContent = this.devices.size;
    }

    updateDevicesList() {
        this.devicesList.innerHTML = '';

        this.devices.forEach((deviceInfo, deviceId) => {
            const card = document.createElement('div');
            card.className = 'device-card';

            const group = this.deviceGroups.get(deviceId);
            const groupBadge = group
                ? `<span class="device-group">${group}</span>`
                : '<span class="device-group no-group">未設定</span>';

            card.innerHTML = `
                <div class="device-info">
                    <span class="device-status-dot"></span>
                    <span class="device-name">${deviceInfo.name}</span>
                    ${groupBadge}
                </div>
                <div class="device-actions">
                    <div class="custom-select-wrapper">
                        <button class="custom-select-btn" data-device="${deviceId}">
                            <span class="select-text">${group ? 'グループ ' + group : 'グループ設定'}</span>
                            <span class="select-arrow">▼</span>
                        </button>
                        <div class="custom-select-dropdown">
                            <div class="select-option" data-value="">グループなし</div>
                            <div class="select-option" data-value="A">グループA</div>
                            <div class="select-option" data-value="B">グループB</div>
                            <div class="select-option" data-value="C">グループC</div>
                        </div>
                    </div>
                    <button class="btn btn-danger btn-disconnect" data-device="${deviceId}">切断</button>
                </div>
            `;

            // カスタムセレクトのイベント
            const selectBtn = card.querySelector('.custom-select-btn');
            const dropdown = card.querySelector('.custom-select-dropdown');
            const options = card.querySelectorAll('.select-option');

            selectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 他の全てのドロップダウンを閉じる
                document.querySelectorAll('.custom-select-dropdown.active').forEach(d => {
                    if (d !== dropdown) d.classList.remove('active');
                });
                dropdown.classList.toggle('active');
            });

            options.forEach(option => {
                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newGroup = option.dataset.value;
                    if (newGroup) {
                        this.deviceGroups.set(deviceId, newGroup);
                    } else {
                        this.deviceGroups.delete(deviceId);
                    }
                    dropdown.classList.remove('active');
                    this.updateDevicesList();
                });
            });

            // 切断ボタンイベント
            const disconnectBtn = card.querySelector('.btn-disconnect');
            disconnectBtn.addEventListener('click', () => this.disconnectDevice(deviceId));

            this.devicesList.appendChild(card);
        });

        // ドロップダウンを閉じるためのグローバルクリックイベント（1回だけ登録）
        if (!this.globalClickHandlerAdded) {
            document.addEventListener('click', () => {
                document.querySelectorAll('.custom-select-dropdown.active').forEach(d => {
                    d.classList.remove('active');
                });
            });
            this.globalClickHandlerAdded = true;
        }
    }

    updateIndividualButtons() {
        this.individualButtons.innerHTML = '';

        this.devices.forEach((deviceInfo, deviceId) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-individual';
            btn.dataset.device = deviceId;
            btn.textContent = deviceInfo.name;

            if (this.selectedDevice === deviceId) {
                btn.classList.add('active');
            }

            btn.addEventListener('click', () => {
                this.selectedDevice = deviceId;
                this.updateIndividualButtons();
            });

            this.individualButtons.appendChild(btn);
        });
    }

    updateGroupButtons() {
        this.groupButtons.querySelectorAll('.btn-group').forEach(btn => {
            if (btn.dataset.group === this.selectedGroup) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // === 制御対象切り替え ===

    switchControlTarget(target) {
        this.controlTarget = target;

        // ボタンの状態更新
        [this.targetAllBtn, this.targetGroupBtn, this.targetIndividualBtn].forEach(btn => {
            btn.classList.remove('active');
        });

        if (target === 'all') {
            this.targetAllBtn.classList.add('active');
            this.groupSelection.style.display = 'none';
            this.individualSelection.style.display = 'none';
        } else if (target === 'group') {
            this.targetGroupBtn.classList.add('active');
            this.groupSelection.style.display = 'block';
            this.individualSelection.style.display = 'none';
            if (!this.selectedGroup) {
                this.selectedGroup = 'A';
            }
            this.updateGroupButtons();
        } else if (target === 'individual') {
            this.targetIndividualBtn.classList.add('active');
            this.groupSelection.style.display = 'none';
            this.individualSelection.style.display = 'block';
            this.updateIndividualButtons();
        }
    }

    // === 制御対象デバイスの取得 ===

    getTargetDevices() {
        const targets = [];

        if (this.controlTarget === 'all') {
            // 全デバイス
            this.devices.forEach((deviceInfo) => {
                targets.push(deviceInfo);
            });
        } else if (this.controlTarget === 'group' && this.selectedGroup) {
            // 選択されたグループのデバイス
            this.devices.forEach((deviceInfo, deviceId) => {
                if (this.deviceGroups.get(deviceId) === this.selectedGroup) {
                    targets.push(deviceInfo);
                }
            });
        } else if (this.controlTarget === 'individual' && this.selectedDevice) {
            // 選択された個別デバイス
            const deviceInfo = this.devices.get(this.selectedDevice);
            if (deviceInfo) {
                targets.push(deviceInfo);
            }
        }

        return targets;
    }

    // === モード切り替え ===

    switchToColorMode() {
        this.colorModeBtn.classList.add('active');
        this.autoModeBtn.classList.remove('active');
        this.colorMode.style.display = 'block';
        this.autoMode.style.display = 'none';

        // 全デバイスの自動モードを停止
        this.devices.forEach((deviceInfo) => {
            if (deviceInfo.isAutoMode) {
                this.sendCommandToDevice(deviceInfo, 'STOP');
                deviceInfo.isAutoMode = false;
            }
        });
    }

    switchToAutoMode() {
        this.autoModeBtn.classList.add('active');
        this.colorModeBtn.classList.remove('active');
        this.autoMode.style.display = 'block';
        this.colorMode.style.display = 'none';
    }

    // === カラーピッカー ===

    draw2DColorPicker() {
        const canvas = this.colorPicker2D;
        const ctx = this.colorPicker2DContext;
        const width = canvas.width;
        const height = canvas.height;

        // ベースカラー
        const baseColor = this.hslToRgb(this.currentHue, 100, 50);
        ctx.fillStyle = `rgb(${baseColor.r}, ${baseColor.g}, ${baseColor.b})`;
        ctx.fillRect(0, 0, width, height);

        // 横方向グラデーション（彩度）
        const saturationGradient = ctx.createLinearGradient(0, 0, width, 0);
        saturationGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        saturationGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = saturationGradient;
        ctx.fillRect(0, 0, width, height);

        // 縦方向グラデーション（明度）
        const lightnessGradient = ctx.createLinearGradient(0, 0, 0, height);
        lightnessGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        lightnessGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
        ctx.fillStyle = lightnessGradient;
        ctx.fillRect(0, 0, width, height);
    }

    updateColorDisplay() {
        this.hueValue.textContent = `${this.currentHue}°`;
        this.saturationValue.textContent = `${Math.round(this.currentSaturation)}%`;
        this.lightnessValue.textContent = `${Math.round(this.currentLightness)}%`;

        const rgb = this.hslToRgb(this.currentHue, this.currentSaturation, this.currentLightness);
        const hexColor = this.rgbToHex(rgb.r, rgb.g, rgb.b);

        this.colorValue.textContent = hexColor.toUpperCase();
        this.colorPreview.style.backgroundColor = hexColor;

        // カーソルに現在の色を設定
        this.colorPickerCursor.style.color = hexColor;
    }

    updateCursorPosition() {
        const canvas = this.colorPicker2D;
        const rect = canvas.getBoundingClientRect();

        const x = (this.currentSaturation / 100) * canvas.width;
        const y = (1 - this.currentLightness / 100) * canvas.height;

        const screenX = rect.left + (x / canvas.width) * rect.width;
        const screenY = rect.top + (y / canvas.height) * rect.height;

        this.colorPickerCursor.style.left = `${screenX}px`;
        this.colorPickerCursor.style.top = `${screenY}px`;
    }

    startPicking(event) {
        this.isDragging = true;
        this.pickColor(event);
    }

    continuePicking(event) {
        if (this.isDragging) {
            this.pickColor(event);
        }
    }

    stopPicking() {
        this.isDragging = false;
    }

    pickColor(event) {
        const canvas = this.colorPicker2D;
        const rect = canvas.getBoundingClientRect();

        let clientX, clientY;
        if (event.touches) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }

        let x = clientX - rect.left;
        let y = clientY - rect.top;

        x = Math.max(0, Math.min(x, rect.width));
        y = Math.max(0, Math.min(y, rect.height));

        this.currentSaturation = (x / rect.width) * 100;
        this.currentLightness = 100 - (y / rect.height) * 100;

        this.updateColorDisplay();
        this.updateCursorPosition();
        this.debouncedApplyColor();
    }

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

    debouncedApplyColor() {
        if (this.colorSendTimer) {
            clearTimeout(this.colorSendTimer);
        }

        this.colorSendTimer = setTimeout(() => {
            this.applyCurrentColor();
        }, this.colorSendDelay);
    }

    async applyCurrentColor() {
        const targets = this.getTargetDevices();
        if (targets.length === 0) {
            return;
        }

        const rgb = this.hslToRgb(this.currentHue, this.currentSaturation, this.currentLightness);

        for (const deviceInfo of targets) {
            try {
                await this.sendColorToDevice(deviceInfo, rgb.r, rgb.g, rgb.b);
                console.log(`${deviceInfo.name}: RGB(${rgb.r}, ${rgb.g}, ${rgb.b})`);
            } catch (error) {
                console.error(`${deviceInfo.name} への送信エラー:`, error);
            }
        }
    }

    // === 自動制御 ===

    async startAutoMode() {
        const targets = this.getTargetDevices();
        if (targets.length === 0) {
            this.showError('制御対象のデバイスがありません');
            return;
        }

        const selectedPattern = document.querySelector('input[name="pattern"]:checked').value;

        for (const deviceInfo of targets) {
            try {
                await this.sendCommandToDevice(deviceInfo, `AUTO:${selectedPattern}`);
                deviceInfo.isAutoMode = true;
                console.log(`${deviceInfo.name}: 自動制御開始 (パターン${selectedPattern})`);
            } catch (error) {
                console.error(`${deviceInfo.name} への送信エラー:`, error);
            }
        }

        this.startAutoBtn.style.display = 'none';
        this.stopAutoBtn.style.display = 'inline-block';
    }

    async stopAutoMode() {
        const targets = this.getTargetDevices();

        for (const deviceInfo of targets) {
            try {
                await this.sendCommandToDevice(deviceInfo, 'STOP');
                deviceInfo.isAutoMode = false;
                console.log(`${deviceInfo.name}: 自動制御停止`);
            } catch (error) {
                console.error(`${deviceInfo.name} への送信エラー:`, error);
            }
        }

        this.stopAutoBtn.style.display = 'none';
        this.startAutoBtn.style.display = 'inline-block';
    }

    async clearLeds() {
        const targets = this.getTargetDevices();
        if (targets.length === 0) {
            return;
        }

        for (const deviceInfo of targets) {
            try {
                if (deviceInfo.isAutoMode) {
                    await this.sendCommandToDevice(deviceInfo, 'STOP');
                    deviceInfo.isAutoMode = false;
                }
                await this.sendCommandToDevice(deviceInfo, 'CLEAR');
                console.log(`${deviceInfo.name}: 消灯`);
            } catch (error) {
                console.error(`${deviceInfo.name} への送信エラー:`, error);
            }
        }
    }

    // === Bluetooth送信 ===

    async sendColorToDevice(deviceInfo, r, g, b) {
        if (!deviceInfo.colorCharacteristic) {
            throw new Error('色制御キャラクタリスティックが利用できません');
        }

        const colorData = new Uint8Array([r, g, b]);
        await deviceInfo.colorCharacteristic.writeValue(colorData);
    }

    async sendCommandToDevice(deviceInfo, command) {
        if (!deviceInfo.controlCharacteristic) {
            throw new Error('制御キャラクタリスティックが利用できません');
        }

        const encoder = new TextEncoder();
        const commandData = encoder.encode(command);
        await deviceInfo.controlCharacteristic.writeValue(commandData);
    }

    // === 色変換関数 ===

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    rgbToHex(r, g, b) {
        const toHex = (n) => {
            const hex = Math.round(n).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    hslToRgb(h, s, l) {
        h = h / 360;
        s = s / 100;
        l = l / 100;

        let r, g, b;

        if (s === 0) {
            r = g = b = l;
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

    rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
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

    // === ユーティリティ ===

    showError(message) {
        alert(message);
    }
}

// アプリケーションの初期化
document.addEventListener('DOMContentLoaded', () => {
    new MultiPenlightController();
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
