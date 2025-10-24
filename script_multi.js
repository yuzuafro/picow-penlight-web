class MultiColorlightController {
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

        // カラーコード入力フィールドのフォーカス状態
        this.colorInputFocused = false;

        // 音楽モード関連
        this.isMusicMode = false;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.musicAnimationId = null;
        this.musicBaseColor = { r: 255, g: 0, b: 0 }; // デフォルトは赤
        this.musicSensitivity = 5;
        this.musicEffectMode = 'brightness'; // brightness, frequency, beat, rainbow
        this.rainbowHue = 0; // レインボーモード用の色相
        this.beatThreshold = 1.3; // ビート検出の閾値（前フレームの1.3倍）
        this.lastVolume = 0; // 前フレームの音量
        this.beatColorIndex = 0; // ビート時の色インデックス
        this.beatColors = [
            { r: 255, g: 0, b: 0 },     // 赤
            { r: 255, g: 165, b: 0 },   // オレンジ
            { r: 255, g: 255, b: 0 },   // 黄
            { r: 0, g: 255, b: 0 },     // 緑
            { r: 0, g: 255, b: 255 },   // シアン
            { r: 0, g: 0, b: 255 },     // 青
            { r: 138, g: 43, b: 226 }   // 紫
        ];

        // Bluetooth送信制御
        this.lastMusicColorSendTime = 0;
        this.musicColorSendInterval = 50; // 音楽モード時の送信間隔（ms）

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
        this.musicModeBtn = document.getElementById('musicModeBtn');
        this.colorMode = document.getElementById('colorMode');
        this.autoMode = document.getElementById('autoMode');
        this.musicMode = document.getElementById('musicMode');

        // カラーピッカー
        this.hueSlider = document.getElementById('hueSlider');
        this.colorValue = document.getElementById('colorValue');
        this.colorPreview = document.getElementById('colorPreview');

        // プリセット色
        this.presetColors = document.querySelectorAll('.preset-color');

        // 自動制御
        this.patternRadios = document.querySelectorAll('input[name="pattern"]');
        this.startAutoBtn = document.getElementById('startAutoBtn');
        this.stopAutoBtn = document.getElementById('stopAutoBtn');

        // 音楽モード
        this.startMusicBtn = document.getElementById('startMusicBtn');
        this.stopMusicBtn = document.getElementById('stopMusicBtn');
        this.musicSettings = document.getElementById('musicSettings');
        this.volumeBar = document.getElementById('volumeBar');
        this.sensitivitySlider = document.getElementById('sensitivitySlider');
        this.sensitivityValue = document.getElementById('sensitivityValue');
        this.musicPresetColors = document.querySelectorAll('.music-preset-color');
        this.musicEffectRadios = document.querySelectorAll('input[name="musicEffect"]');
        this.baseColorLabel = document.getElementById('baseColorLabel');
        this.musicColorPreset = document.getElementById('musicColorPreset');

        // 共通コントロール
        this.clearBtn = document.getElementById('clearBtn');

        // 初期化
        this.updateColorDisplay();
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
        this.musicModeBtn.addEventListener('click', () => this.switchToMusicMode());

        // 色相スライダー
        this.hueSlider.addEventListener('input', () => {
            this.currentHue = parseInt(this.hueSlider.value);
            this.updateColorDisplay();
            this.debouncedApplyColor();
        });

        // カラーコード入力欄
        this.colorValue.addEventListener('focus', () => {
            // フォーカス時は自動更新を一時停止
            this.colorInputFocused = true;
        });

        this.colorValue.addEventListener('blur', () => {
            // フォーカスアウト時に自動更新を再開
            this.colorInputFocused = false;
        });

        this.colorValue.addEventListener('change', (e) => {
            const hexColor = e.target.value.trim().toUpperCase();
            if (this.isValidHexColor(hexColor)) {
                // #を追加（なければ）
                const normalizedHex = hexColor.startsWith('#') ? hexColor : '#' + hexColor;
                this.setColorFromHex(normalizedHex);
                this.applyCurrentColor();
            } else {
                // 無効な値の場合は現在の色に戻す
                this.updateColorDisplay();
            }
        });

        this.colorValue.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur(); // Enterキーでフォーカスを外してchangeイベントを発火
            }
        });

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

        // 音楽モード
        this.startMusicBtn.addEventListener('click', () => this.startMusicMode());
        this.stopMusicBtn.addEventListener('click', () => this.stopMusicMode());

        this.sensitivitySlider.addEventListener('input', () => {
            this.musicSensitivity = parseInt(this.sensitivitySlider.value);
            this.sensitivityValue.textContent = this.musicSensitivity;
        });

        this.musicPresetColors.forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;
                const rgb = this.hexToRgb(color);
                if (rgb) {
                    this.musicBaseColor = rgb;
                    // アクティブ状態を更新
                    this.musicPresetColors.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
            });
        });

        // エフェクトモード切り替え
        this.musicEffectRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                this.musicEffectMode = radio.value;
                // エフェクトモードに応じてUIを更新
                this.updateMusicEffectUI();
            });
        });

        // 共通コントロール
        this.clearBtn.addEventListener('click', () => this.clearLeds());
    }

    updateMusicEffectUI() {
        // 周波数連動、音階連動、レインボーモードではベースカラー選択を非表示
        if (this.musicEffectMode === 'frequency' || this.musicEffectMode === 'musicalScale' || this.musicEffectMode === 'rainbow') {
            this.baseColorLabel.style.display = 'none';
            this.musicColorPreset.style.display = 'none';
        } else {
            this.baseColorLabel.style.display = 'block';
            this.musicColorPreset.style.display = 'grid';
        }
    }

    checkBluetoothSupport() {
        if (!navigator.bluetooth) {
            this.showError('このブラウザはWeb Bluetooth APIをサポートしていません。Chrome、Edge、またはOperaをお使いください。');
            this.connectBtn.disabled = true;
            return false;
        }
        console.log('Web Bluetooth API サポート: OK');
        return true;
    }

    // === デバイス接続管理 ===

    async connect() {
        try {
            this.connectBtn.classList.add('loading');
            console.log('Bluetooth接続を開始します...');
            console.log('検索条件: namePrefix="Colorlight-"');

            // デバイスの検索（旧形式"Colorlight"と新形式"Colorlight-X"の両方に対応）
            const device = await navigator.bluetooth.requestDevice({
                filters: [
                    { namePrefix: 'Colorlight-' },
                    { name: 'Colorlight' }
                ],
                optionalServices: [this.SERVICE_UUID]
            });

            const deviceId = this.extractDeviceId(device.name);
            console.log('デバイスが選択されました:', device.name, 'ID:', deviceId);

            // 既に接続されているかチェック
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
                isAutoMode: false,
                isSending: false,  // 送信中フラグ
                lastColor: { r: 0, g: 0, b: 0 }  // 最後に送信した色
            });

            // 接続時に初期色（赤）を送信
            const deviceInfo = this.devices.get(deviceId);
            await this.sendColorToDevice(deviceInfo, 255, 0, 0);

            this.onDeviceConnected(deviceId);
            console.log(`デバイス ${device.name} に接続しました (初期色: 赤)`);
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
        // "Colorlight-1" -> "1"
        const match = deviceName.match(/Colorlight-(\d+)/);
        if (match) {
            return match[1];
        }
        // "Colorlight" -> "default"（旧形式の場合）
        if (deviceName === 'Colorlight') {
            return 'default';
        }
        return deviceName;
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
            const selectWrapper = card.querySelector('.custom-select-wrapper');
            const selectBtn = card.querySelector('.custom-select-btn');
            const dropdown = card.querySelector('.custom-select-dropdown');
            const options = card.querySelectorAll('.select-option');

            selectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 他の全てのドロップダウンを閉じる
                document.querySelectorAll('.custom-select-wrapper.active').forEach(w => {
                    if (w !== selectWrapper) {
                        w.classList.remove('active');
                        w.querySelector('.custom-select-dropdown').classList.remove('active');
                    }
                });
                // 現在のドロップダウンをトグル
                selectWrapper.classList.toggle('active');
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
                    selectWrapper.classList.remove('active');
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
                document.querySelectorAll('.custom-select-wrapper.active').forEach(w => {
                    w.classList.remove('active');
                    w.querySelector('.custom-select-dropdown').classList.remove('active');
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
        this.musicModeBtn.classList.remove('active');
        this.colorMode.style.display = 'block';
        this.autoMode.style.display = 'none';
        this.musicMode.style.display = 'none';

        // 全デバイスの自動モードを停止
        this.devices.forEach((deviceInfo) => {
            if (deviceInfo.isAutoMode) {
                this.sendCommandToDevice(deviceInfo, 'STOP');
                deviceInfo.isAutoMode = false;
            }
        });

        // 音楽モードが動いていたら停止
        if (this.isMusicMode) {
            this.stopMusicMode();
        }
    }

    switchToAutoMode() {
        this.autoModeBtn.classList.add('active');
        this.colorModeBtn.classList.remove('active');
        this.musicModeBtn.classList.remove('active');
        this.autoMode.style.display = 'block';
        this.colorMode.style.display = 'none';
        this.musicMode.style.display = 'none';

        // 音楽モードが動いていたら停止
        if (this.isMusicMode) {
            this.stopMusicMode();
        }
    }

    switchToMusicMode() {
        this.musicModeBtn.classList.add('active');
        this.colorModeBtn.classList.remove('active');
        this.autoModeBtn.classList.remove('active');
        this.musicMode.style.display = 'block';
        this.colorMode.style.display = 'none';
        this.autoMode.style.display = 'none';

        // 全デバイスの自動モードを停止
        this.devices.forEach((deviceInfo) => {
            if (deviceInfo.isAutoMode) {
                this.sendCommandToDevice(deviceInfo, 'STOP');
                deviceInfo.isAutoMode = false;
            }
        });
    }

    // === カラーピッカー ===

    updateColorDisplay() {
        const rgb = this.hslToRgb(this.currentHue, this.currentSaturation, this.currentLightness);
        const hexColor = this.rgbToHex(rgb.r, rgb.g, rgb.b);

        // 入力フィールドがフォーカスされていない場合のみ更新
        if (!this.colorInputFocused) {
            this.colorValue.value = hexColor.toUpperCase();
        }
        this.colorPreview.style.backgroundColor = hexColor;
    }

    setColorFromHex(hexColor) {
        const rgb = this.hexToRgb(hexColor);
        if (!rgb) return;

        const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);

        this.currentHue = Math.round(hsl.h);
        this.currentSaturation = Math.round(hsl.s);
        this.currentLightness = Math.round(hsl.l);

        // 色相スライダーの値を更新
        this.hueSlider.value = this.currentHue;

        // 表示を更新
        this.updateColorDisplay();
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
        // デバイスの接続状態をチェック
        if (!deviceInfo.device || !deviceInfo.device.gatt || !deviceInfo.device.gatt.connected) {
            return; // 切断されている場合は静かに終了
        }

        if (!deviceInfo.colorCharacteristic) {
            throw new Error('色制御キャラクタリスティックが利用できません');
        }

        // 送信中の場合はスキップ
        if (deviceInfo.isSending) {
            return;
        }

        // 最後に送信した色と同じ場合はスキップ（音楽モード時の最適化）
        if (this.isMusicMode &&
            deviceInfo.lastColor.r === r &&
            deviceInfo.lastColor.g === g &&
            deviceInfo.lastColor.b === b) {
            return;
        }

        try {
            deviceInfo.isSending = true;
            const colorData = new Uint8Array([r, g, b]);
            await deviceInfo.colorCharacteristic.writeValue(colorData);

            // 送信成功時に最後の色を記録
            deviceInfo.lastColor = { r, g, b };
        } catch (error) {
            // 切断エラーは無視（デバイスが切断された可能性）
            if (error.message && error.message.includes('GATT Server is disconnected')) {
                return;
            }
            // その他のエラーは再スロー
            throw error;
        } finally {
            deviceInfo.isSending = false;
        }
    }

    async sendCommandToDevice(deviceInfo, command) {
        // デバイスの接続状態をチェック
        if (!deviceInfo.device || !deviceInfo.device.gatt || !deviceInfo.device.gatt.connected) {
            return; // 切断されている場合は静かに終了
        }

        if (!deviceInfo.controlCharacteristic) {
            throw new Error('制御キャラクタリスティックが利用できません');
        }

        try {
            const encoder = new TextEncoder();
            const commandData = encoder.encode(command);
            await deviceInfo.controlCharacteristic.writeValue(commandData);
        } catch (error) {
            // 切断エラーは無視（デバイスが切断された可能性）
            if (error.message && error.message.includes('GATT Server is disconnected')) {
                return;
            }
            // その他のエラーは再スロー
            throw error;
        }
    }

    // === 色変換関数 ===

    isValidHexColor(hex) {
        return /^#?[0-9A-Fa-f]{6}$/i.test(hex);
    }

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

    // === 音楽モード ===

    async startMusicMode() {
        const targets = this.getTargetDevices();
        if (targets.length === 0) {
            this.showError('制御対象のデバイスがありません');
            return;
        }

        try {
            // マイクへのアクセスを要求
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

            // Web Audio APIのセットアップ
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 4096; // 周波数解像度を上げる（256→4096で約11.7Hz/bin）
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);

            this.isMusicMode = true;
            this.startMusicBtn.style.display = 'none';
            this.stopMusicBtn.style.display = 'inline-block';
            this.musicSettings.style.display = 'block';

            // 音声解析ループを開始
            this.analyzeMusicLoop();

            console.log('音楽連動モード開始');
        } catch (error) {
            console.error('マイクアクセスエラー:', error);
            this.showError('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
        }
    }

    stopMusicMode() {
        this.isMusicMode = false;

        // アニメーションループを停止
        if (this.musicAnimationId) {
            cancelAnimationFrame(this.musicAnimationId);
            this.musicAnimationId = null;
        }

        // Audio Contextをクリーンアップ
        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.analyser = null;

        this.stopMusicBtn.style.display = 'none';
        this.startMusicBtn.style.display = 'inline-block';
        this.musicSettings.style.display = 'none';

        // 音量バーをリセット
        this.volumeBar.style.width = '0%';

        console.log('音楽連動モード停止');
    }

    analyzeMusicLoop() {
        if (!this.isMusicMode || !this.analyser) {
            return;
        }

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        // 平均音量を計算
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;

        // 感度を適用 (1-10 -> 0.5-2.0の乗数)
        const sensitivityMultiplier = this.musicSensitivity / 5;
        const adjustedVolume = Math.min(255, average * sensitivityMultiplier * 2);

        // 音量バーを更新
        const volumePercent = (adjustedVolume / 255) * 100;
        this.volumeBar.style.width = `${volumePercent}%`;

        // エフェクトモードに応じて色を計算
        let r, g, b;

        switch (this.musicEffectMode) {
            case 'brightness':
                // 明るさ変化モード：ベースカラーの明るさを音量に応じて調整
                const brightness = adjustedVolume / 255;
                r = Math.round(this.musicBaseColor.r * brightness);
                g = Math.round(this.musicBaseColor.g * brightness);
                b = Math.round(this.musicBaseColor.b * brightness);
                break;

            case 'frequency':
                // 周波数連動モード：低音=赤、中音=緑、高音=青
                const lowFreq = this.getFrequencyRange(dataArray, 0, bufferLength / 3);
                const midFreq = this.getFrequencyRange(dataArray, bufferLength / 3, 2 * bufferLength / 3);
                const highFreq = this.getFrequencyRange(dataArray, 2 * bufferLength / 3, bufferLength);

                r = Math.min(255, Math.round(lowFreq * sensitivityMultiplier));
                g = Math.min(255, Math.round(midFreq * sensitivityMultiplier));
                b = Math.min(255, Math.round(highFreq * sensitivityMultiplier));
                break;

            case 'musicalScale':
                // 音階連動モード：ドレミファソラシ (C4-B5) の範囲を虹色に変化
                // 倍音の影響を考慮し、ピーク検出とコントラスト計算で基本周波数を特定
                const sampleRate = this.audioContext.sampleRate;
                const fftSize = this.analyser.fftSize;

                // 周波数ビンの解像度（Hz per bin）
                const frequencyResolution = sampleRate / fftSize;

                // ドレミファソラシの7音階の基本周波数（2オクターブ分）
                // 各音階の中心周波数のみを使用してピーク検出
                const musicalNotes = [
                    { name: 'ド (C)',  centerFreqs: [261.6, 523.3], hue: 0 },      // 赤
                    { name: 'レ (D)',  centerFreqs: [293.7, 587.3], hue: 30 },     // オレンジ
                    { name: 'ミ (E)',  centerFreqs: [329.6, 659.3], hue: 60 },     // 黄色
                    { name: 'ファ (F)', centerFreqs: [349.2, 698.5], hue: 120 },   // 緑
                    { name: 'ソ (G)',  centerFreqs: [392.0, 784.0], hue: 180 },    // シアン
                    { name: 'ラ (A)',  centerFreqs: [440.0, 880.0], hue: 240 },    // 青
                    { name: 'シ (B)',  centerFreqs: [493.9, 987.8], hue: 280 }     // 紫
                ];

                // 各音階のピーク強度を計算（周辺との差分を考慮）
                let maxScore = 0;
                let dominantHue = 0;
                let dominantNote = '';

                for (const note of musicalNotes) {
                    let noteScore = 0;

                    for (const centerFreq of note.centerFreqs) {
                        const centerBin = Math.floor(centerFreq / frequencyResolution);

                        // 中心周波数の±3ビンの範囲でピークを検出
                        const peakRange = 3;
                        let peakSum = 0;
                        let peakCount = 0;

                        for (let i = -peakRange; i <= peakRange; i++) {
                            const bin = centerBin + i;
                            if (bin >= 0 && bin < dataArray.length) {
                                peakSum += dataArray[bin];
                                peakCount++;
                            }
                        }

                        const peakAvg = peakSum / peakCount;

                        // 周辺（±10ビン外側）の平均値を取得してノイズレベルを推定
                        const surroundRange = 10;
                        let surroundSum = 0;
                        let surroundCount = 0;

                        for (let i = -surroundRange - peakRange; i < -peakRange; i++) {
                            const bin = centerBin + i;
                            if (bin >= 0 && bin < dataArray.length) {
                                surroundSum += dataArray[bin];
                                surroundCount++;
                            }
                        }
                        for (let i = peakRange + 1; i <= surroundRange + peakRange; i++) {
                            const bin = centerBin + i;
                            if (bin >= 0 && bin < dataArray.length) {
                                surroundSum += dataArray[bin];
                                surroundCount++;
                            }
                        }

                        const surroundAvg = surroundSum / surroundCount;

                        // コントラスト（ピーク - 周辺）を計算して、際立ちを評価
                        const contrast = Math.max(0, peakAvg - surroundAvg);

                        // 低音域（第1オクターブ）を1.5倍優先
                        const weight = (centerFreq < 520) ? 1.5 : 1.0;
                        noteScore += contrast * weight;
                    }

                    if (noteScore > maxScore) {
                        maxScore = noteScore;
                        dominantHue = note.hue;
                        dominantNote = note.name;
                    }
                }

                const maxIntensity = maxScore;

                // 音量が十分にある場合のみ色を出力
                if (maxIntensity > 10) {
                    const musicalRgb = this.hslToRgb(dominantHue, 100, 50);
                    const musicalBrightness = Math.min(1, (maxIntensity * sensitivityMultiplier) / 255);
                    r = Math.round(musicalRgb.r * musicalBrightness);
                    g = Math.round(musicalRgb.g * musicalBrightness);
                    b = Math.round(musicalRgb.b * musicalBrightness);
                } else {
                    // 音が小さい場合は消灯
                    r = g = b = 0;
                }
                break;

            case 'beat':
                // ビート検出モード：音量が急上昇したら色変化
                if (adjustedVolume > this.lastVolume * this.beatThreshold && adjustedVolume > 50) {
                    // ビート検出！色を変更
                    this.beatColorIndex = (this.beatColorIndex + 1) % this.beatColors.length;
                }

                const currentColor = this.beatColors[this.beatColorIndex];
                const beatBrightness = adjustedVolume / 255;
                r = Math.round(currentColor.r * beatBrightness);
                g = Math.round(currentColor.g * beatBrightness);
                b = Math.round(currentColor.b * beatBrightness);

                this.lastVolume = adjustedVolume;
                break;

            case 'rainbow':
                // レインボーモード：音量に応じて虹色がスクロール
                if (adjustedVolume > 20) {
                    // 音が鳴っているときだけ色相を進める
                    this.rainbowHue = (this.rainbowHue + adjustedVolume / 50) % 360;
                }

                const rainbowRgb = this.hslToRgb(this.rainbowHue, 100, 50);
                const rainbowBrightness = Math.max(0.3, adjustedVolume / 255); // 最低30%の明るさ
                r = Math.round(rainbowRgb.r * rainbowBrightness);
                g = Math.round(rainbowRgb.g * rainbowBrightness);
                b = Math.round(rainbowRgb.b * rainbowBrightness);
                break;

            default:
                r = g = b = 0;
        }

        // 制御対象デバイスに色を送信（スロットリング付き）
        const now = Date.now();
        if (now - this.lastMusicColorSendTime >= this.musicColorSendInterval) {
            this.lastMusicColorSendTime = now;

            const targets = this.getTargetDevices();
            for (const deviceInfo of targets) {
                // awaitせずに非同期で送信（sendColorToDevice内で競合制御）
                this.sendColorToDevice(deviceInfo, r, g, b).catch(error => {
                    // エラーはログに記録するが処理は継続
                    if (error.message && !error.message.includes('GATT operation already in progress')) {
                        console.error(`${deviceInfo.name} への送信エラー:`, error);
                    }
                });
            }
        }

        // 次のフレームをスケジュール
        this.musicAnimationId = requestAnimationFrame(() => this.analyzeMusicLoop());
    }

    // 指定範囲の周波数の平均値を取得
    getFrequencyRange(dataArray, start, end) {
        let sum = 0;
        const startIdx = Math.floor(start);
        const endIdx = Math.floor(end);

        // 範囲が無効な場合は0を返す
        if (startIdx >= endIdx || startIdx < 0 || endIdx > dataArray.length) {
            return 0;
        }

        for (let i = startIdx; i < endIdx; i++) {
            sum += dataArray[i];
        }

        return sum / (endIdx - startIdx);
    }

    // === ユーティリティ ===

    showError(message) {
        alert(message);
    }
}

// アプリケーションの初期化
document.addEventListener('DOMContentLoaded', () => {
    new MultiColorlightController();
});
