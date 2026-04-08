-- =====================================================
-- Roblox Admin Panel - Premium Edition (BLACK/WHITE REDESIGN)
-- Features: Cleanes Design, Singleton, Spielerliste, ESP, Find, Watch, Account-Alter
-- Öffnen/Schließen mit F2
-- =====================================================

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local LocalPlayer = Players.LocalPlayer
local Mouse = LocalPlayer:GetMouse()
local Camera = workspace.CurrentCamera

-- ===== SINGLETON: Alte Instanz beenden =====
local singletonName = "AdminPanel_Singleton"
local coreGui = game:GetService("CoreGui")
local existing = coreGui:FindFirstChild(singletonName)
if existing then
    existing:Destroy()
end
local singletonFolder = Instance.new("Folder")
singletonFolder.Name = singletonName
singletonFolder.Parent = coreGui

-- ===== Globale Variablen =====
local mainGui = nil
local rightPanel = nil
local selectedPlayer = nil
local lastSelectedPlayerName = nil
local espActive = false
local antiAFKActive = false
local antiAFKConnection = nil
local findObject = nil
local findTargetPlayer = nil
local findConnection = nil
local findOverlay = nil
local scriptRunning = true

-- Watch-Modus
local watchingPlayer = nil
local watchConnection = nil
local watchOverlay = nil
local previousEspState = false

-- Cache für Account-Alter
local accountAgeCache = {}

-- ===== DESIGN-KONSTANTEN (Schwarz/Weiß) =====
local COLOR_BG = Color3.fromRGB(0, 0, 0)           -- reines Schwarz
local COLOR_PANEL = Color3.fromRGB(10, 10, 10)     -- fast Schwarz für Panels
local COLOR_ACCENT = Color3.fromRGB(30, 30, 30)    -- dunkles Grau für Hover/Kontrast
local COLOR_TEXT = Color3.fromRGB(255, 255, 255)   -- Weiß
local COLOR_BUTTON = Color3.fromRGB(20, 20, 20)    -- dunkelgraue Buttons
local COLOR_BUTTON_HOVER = Color3.fromRGB(50, 50, 50)
local COLOR_DANGER = Color3.fromRGB(255, 60, 60)   -- Rot für Beenden/Abbrechen
local COLOR_SUCCESS = Color3.fromRGB(60, 255, 60)  -- Grün für Aktionen
local COLOR_INFO = Color3.fromRGB(100, 150, 255)   -- Blau für Zuschauen

local CORNER_RADIUS = UDim.new(0, 8)
local FONT = Enum.Font.Gotham

-- ===== Hilfsfunktionen =====
local function copyToClipboard(text)
    if setclipboard then pcall(setclipboard, text)
    elseif toclipboard then pcall(toclipboard, text)
    elseif clipboard then pcall(clipboard, text)
    end
end

local function getTeamColor(player)
    local team = player.Team
    if team then
        local hash = 0
        for i = 1, #team.Name do hash = hash + string.byte(team.Name, i) end
        return Color3.fromHSV((hash % 360) / 360, 0.8, 0.9)
    end
    return COLOR_ACCENT
end

local function fetchAccountAge(player, callback)
    local userId = player.UserId
    if accountAgeCache[userId] then
        callback(accountAgeCache[userId])
        return
    end

    local url = "https://users.roblox.com/v1/users/" .. userId
    local success, result = pcall(function()
        if syn and syn.request then
            return syn.request({ Url = url, Method = "GET" })
        elseif request then
            return request({ Url = url, Method = "GET" })
        end
    end)

    if success and result and result.Body then
        local data = game:GetService("HttpService"):JSONDecode(result.Body)
        local createdStr = data.created
        if createdStr then
            local year, month, day = createdStr:match("(%d+)-(%d+)-(%d+)")
            if year and month and day then
                local createdDate = os.time({ year = tonumber(year), month = tonumber(month), day = tonumber(day) })
                local ageDays = math.floor((os.time() - createdDate) / 86400)
                accountAgeCache[userId] = ageDays
                callback(ageDays)
                return
            end
        end
    end
    accountAgeCache[userId] = -1
    callback(-1)
end

-- ===== NEUES ESP =====
local function createESP(player)
    if not player.Character then return end
    local char = player.Character
    pcall(function()
        local old = char:FindFirstChild("ESP_Highlight")
        if old then old:Destroy() end
        local highlight = Instance.new("Highlight")
        highlight.Name = "ESP_Highlight"
        highlight.FillColor = Color3.fromRGB(0, 255, 0)
        highlight.FillTransparency = 0.5
        highlight.OutlineTransparency = 1
        highlight.Parent = char

        if char:FindFirstChild("Head") then
            local head = char.Head
            local bill = Instance.new("BillboardGui")
            bill.Name = "ESP_NameTag"
            bill.Size = UDim2.new(0, 200, 0, 30)
            bill.Adornee = head
            bill.AlwaysOnTop = true
            bill.StudsOffset = Vector3.new(0, 2.5, 0)
            bill.Parent = head
            local label = Instance.new("TextLabel")
            label.Size = UDim2.new(1, 0, 1, 0)
            label.BackgroundTransparency = 1
            label.Text = player.DisplayName
            label.TextColor3 = COLOR_TEXT
            label.TextSize = 16
            label.Font = FONT
            label.TextStrokeTransparency = 0.3
            label.Parent = bill
        end
    end)
end

local function removeESP(player)
    if player.Character then
        pcall(function()
            local h = player.Character:FindFirstChild("ESP_Highlight")
            if h then h:Destroy() end
            if player.Character:FindFirstChild("Head") then
                local b = player.Character.Head:FindFirstChild("ESP_NameTag")
                if b then b:Destroy() end
            end
        end)
    end
end

local function updateAllESP()
    if espActive then
        for _, plr in ipairs(Players:GetPlayers()) do
            if plr ~= LocalPlayer then createESP(plr) end
        end
    else
        for _, plr in ipairs(Players:GetPlayers()) do
            if plr ~= LocalPlayer then removeESP(plr) end
        end
    end
end

for _, player in ipairs(Players:GetPlayers()) do
    if player ~= LocalPlayer then
        player.CharacterAdded:Connect(function() if espActive then task.wait(0.1) createESP(player) end end)
    end
end
Players.PlayerAdded:Connect(function(player)
    if player ~= LocalPlayer then
        player.CharacterAdded:Connect(function() if espActive then task.wait(0.1) createESP(player) end end)
    end
end)

-- ===== FIND =====
local function stopFind()
    if findConnection then pcall(function() findConnection:Disconnect() end) findConnection = nil end
    if findObject then
        pcall(function()
            if findObject:IsA("Part") then findObject:Destroy()
            elseif type(findObject.Remove) == "function" then findObject.Visible = false findObject:Remove() end
        end)
        findObject = nil
    end
    if findOverlay then pcall(function() findOverlay:Destroy() end) findOverlay = nil end
    findTargetPlayer = nil
end

local function startFind(targetPlayer)
    stopFind()
    findTargetPlayer = targetPlayer

    findOverlay = Instance.new("ScreenGui")
    findOverlay.Name = "FindOverlay"
    findOverlay.ResetOnSpawn = false
    findOverlay.Parent = coreGui

    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(0, 300, 0, 60)
    frame.Position = UDim2.new(0.5, -150, 1, -100)
    frame.BackgroundColor3 = COLOR_PANEL
    frame.BorderSizePixel = 0
    Instance.new("UICorner", frame).CornerRadius = CORNER_RADIUS
    frame.Parent = findOverlay

    local nameLabel = Instance.new("TextLabel")
    nameLabel.Size = UDim2.new(1, -20, 0, 30)
    nameLabel.Position = UDim2.new(0, 10, 0, 5)
    nameLabel.BackgroundTransparency = 1
    nameLabel.Text = "Suche: " .. targetPlayer.DisplayName
    nameLabel.TextColor3 = COLOR_TEXT
    nameLabel.TextSize = 18
    nameLabel.Font = FONT
    nameLabel.Parent = frame

    local cancelBtn = Instance.new("TextButton")
    cancelBtn.Size = UDim2.new(0, 100, 0, 30)
    cancelBtn.Position = UDim2.new(0.5, -50, 0, 35)
    cancelBtn.Text = "Abbrechen"
    cancelBtn.BackgroundColor3 = COLOR_DANGER
    cancelBtn.TextColor3 = COLOR_TEXT
    cancelBtn.Font = FONT
    Instance.new("UICorner", cancelBtn).CornerRadius = CORNER_RADIUS
    cancelBtn.MouseButton1Click:Connect(stopFind)
    cancelBtn.Parent = frame

    if Drawing and Drawing.new then
        local line = Drawing.new("Line")
        line.Thickness = 3
        line.Color = Color3.fromRGB(255, 100, 0)
        line.Transparency = 0.5
        line.Visible = true
        findObject = line
        findConnection = RunService.RenderStepped:Connect(function()
            if not findObject or not findTargetPlayer or not findTargetPlayer.Character or not findTargetPlayer.Character:FindFirstChild("Head") then stopFind() return end
            local targetHead = findTargetPlayer.Character.Head
            local targetPos, onScreen = Camera:WorldToViewportPoint(targetHead.Position)
            if onScreen then
                local myHead = LocalPlayer.Character and LocalPlayer.Character:FindFirstChild("Head")
                local start = Vector2.new(Mouse.X, Mouse.Y)
                if myHead then
                    local myScreen = Camera:WorldToViewportPoint(myHead.Position)
                    start = Vector2.new(myScreen.X, myScreen.Y)
                end
                findObject.From = start
                findObject.To = Vector2.new(targetPos.X, targetPos.Y)
            end
            local myChar = LocalPlayer.Character
            if myChar and myChar:FindFirstChild("HumanoidRootPart") and findTargetPlayer.Character and findTargetPlayer.Character:FindFirstChild("HumanoidRootPart") then
                if (myChar.HumanoidRootPart.Position - findTargetPlayer.Character.HumanoidRootPart.Position).Magnitude < 10 then
                    stopFind()
                end
            end
        end)
    else
        local part = Instance.new("Part")
        part.Size = Vector3.new(2,2,2)
        part.BrickColor = BrickColor.new("Bright orange")
        part.Material = Enum.Material.Neon
        part.Anchored = true
        part.CanCollide = false
        part.Parent = workspace
        findObject = part
        findConnection = RunService.RenderStepped:Connect(function()
            if not findObject or not findTargetPlayer or not findTargetPlayer.Character or not findTargetPlayer.Character:FindFirstChild("HumanoidRootPart") then stopFind() return end
            local targetPos = findTargetPlayer.Character.HumanoidRootPart.Position
            findObject.Position = targetPos + Vector3.new(0,3,0)
            local myChar = LocalPlayer.Character
            if myChar and myChar:FindFirstChild("HumanoidRootPart") then
                if (myChar.HumanoidRootPart.Position - targetPos).Magnitude < 10 then stopFind() end
            end
        end)
    end
end

-- ===== ANTI-AFK =====
local function setAntiAFK(enabled)
    antiAFKActive = enabled
    if antiAFKConnection then antiAFKConnection:Disconnect() antiAFKConnection = nil end
    if enabled then
        antiAFKConnection = RunService.Stepped:Connect(function()
            if not antiAFKActive then return end
            if tick() % 6 < 0.1 then
                local hum = LocalPlayer.Character and LocalPlayer.Character:FindFirstChild("Humanoid")
                if hum then hum:ChangeState(Enum.HumanoidStateType.Jumping) end
            end
        end)
    end
end

-- ===== WATCH-MODUS =====
local function getOtherPlayersSorted()
    local list = {}
    for _, p in ipairs(Players:GetPlayers()) do if p ~= LocalPlayer then table.insert(list, p) end end
    table.sort(list, function(a,b) return a.DisplayName:lower() < b.DisplayName:lower() end)
    return list
end

local function stopWatching()
    if watchConnection then watchConnection:Disconnect() watchConnection = nil end
    if watchOverlay then watchOverlay:Destroy() watchOverlay = nil end
    if watchingPlayer then
        Camera.CameraSubject = LocalPlayer.Character and LocalPlayer.Character:FindFirstChild("Humanoid")
        Camera.CameraType = Enum.CameraType.Custom
        watchingPlayer = nil
    end
    espActive = previousEspState
    updateAllESP()
end

local function updateWatchOverlay(player)
    if watchOverlay then
        local lbl = watchOverlay:FindFirstChild("NameLabel", true)
        if lbl then lbl.Text = player.DisplayName .. " (@" .. player.Name .. ")" end
    end
end

local function switchWatchTarget(dir)
    if not watchingPlayer then return end
    local list = getOtherPlayersSorted()
    if #list == 0 then return end
    local idx = table.find(list, watchingPlayer) or 1
    idx = idx + dir
    if idx < 1 then idx = #list elseif idx > #list then idx = 1 end
    local newPlayer = list[idx]
    if watchConnection then watchConnection:Disconnect() end
    watchingPlayer = newPlayer
    updateWatchOverlay(newPlayer)
    watchConnection = RunService.RenderStepped:Connect(function()
        if not watchingPlayer or not watchingPlayer.Character or not watchingPlayer.Character:FindFirstChild("HumanoidRootPart") then return end
        local root = watchingPlayer.Character.HumanoidRootPart
        local look = root.CFrame.LookVector
        Camera.CFrame = CFrame.lookAt(root.Position + (look * -12) + Vector3.new(0,5,0), root.Position)
    end)
end

local function startWatching(player)
    if player == LocalPlayer then return end
    if watchingPlayer then
        watchingPlayer = player
        updateWatchOverlay(player)
        if watchConnection then watchConnection:Disconnect() end
        watchConnection = RunService.RenderStepped:Connect(function()
            if not watchingPlayer or not watchingPlayer.Character or not watchingPlayer.Character:FindFirstChild("HumanoidRootPart") then return end
            local root = watchingPlayer.Character.HumanoidRootPart
            local look = root.CFrame.LookVector
            Camera.CFrame = CFrame.lookAt(root.Position + (look * -12) + Vector3.new(0,5,0), root.Position)
        end)
        return
    end

    previousEspState = espActive
    espActive = true
    updateAllESP()
    if mainGui then mainGui:Destroy() mainGui = nil end

    watchingPlayer = player
    Camera.CameraType = Enum.CameraType.Scriptable
    Camera.CameraSubject = nil
    watchConnection = RunService.RenderStepped:Connect(function()
        if not watchingPlayer or not watchingPlayer.Character or not watchingPlayer.Character:FindFirstChild("HumanoidRootPart") then return end
        local root = watchingPlayer.Character.HumanoidRootPart
        local look = root.CFrame.LookVector
        Camera.CFrame = CFrame.lookAt(root.Position + (look * -12) + Vector3.new(0,5,0), root.Position)
    end)

    watchOverlay = Instance.new("ScreenGui")
    watchOverlay.Name = "WatchOverlay"
    watchOverlay.ResetOnSpawn = false
    watchOverlay.Parent = coreGui

    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(0, 400, 0, 70)
    frame.Position = UDim2.new(0.5, -200, 1, -120)
    frame.BackgroundColor3 = COLOR_PANEL
    frame.BorderSizePixel = 0
    Instance.new("UICorner", frame).CornerRadius = CORNER_RADIUS
    frame.Parent = watchOverlay

    local leftBtn = Instance.new("TextButton")
    leftBtn.Size = UDim2.new(0, 50, 0, 50)
    leftBtn.Position = UDim2.new(0, 10, 0, 10)
    leftBtn.Text = "◀"
    leftBtn.TextSize = 30
    leftBtn.BackgroundColor3 = COLOR_ACCENT
    leftBtn.TextColor3 = COLOR_TEXT
    Instance.new("UICorner", leftBtn).CornerRadius = CORNER_RADIUS
    leftBtn.MouseButton1Click:Connect(function() switchWatchTarget(-1) end)
    leftBtn.Parent = frame

    local rightBtn = Instance.new("TextButton")
    rightBtn.Size = UDim2.new(0, 50, 0, 50)
    rightBtn.Position = UDim2.new(1, -60, 0, 10)
    rightBtn.Text = "▶"
    rightBtn.TextSize = 30
    rightBtn.BackgroundColor3 = COLOR_ACCENT
    rightBtn.TextColor3 = COLOR_TEXT
    Instance.new("UICorner", rightBtn).CornerRadius = CORNER_RADIUS
    rightBtn.MouseButton1Click:Connect(function() switchWatchTarget(1) end)
    rightBtn.Parent = frame

    local nameLabel = Instance.new("TextLabel")
    nameLabel.Name = "NameLabel"
    nameLabel.Size = UDim2.new(1, -140, 0, 30)
    nameLabel.Position = UDim2.new(0, 70, 0, 10)
    nameLabel.BackgroundTransparency = 1
    nameLabel.Text = player.DisplayName .. " (@" .. player.Name .. ")"
    nameLabel.TextColor3 = COLOR_TEXT
    nameLabel.TextSize = 18
    nameLabel.Font = FONT
    nameLabel.Parent = frame

    local stopBtn = Instance.new("TextButton")
    stopBtn.Size = UDim2.new(0, 100, 0, 30)
    stopBtn.Position = UDim2.new(0.5, -50, 0, 45)
    stopBtn.Text = "Beenden"
    stopBtn.BackgroundColor3 = COLOR_DANGER
    stopBtn.TextColor3 = COLOR_TEXT
    Instance.new("UICorner", stopBtn).CornerRadius = CORNER_RADIUS
    stopBtn.MouseButton1Click:Connect(stopWatching)
    stopBtn.Parent = frame
end

-- ===== RECHTES PANEL (Spieler-Details) =====
local function showPlayerDetails(player)
    if not rightPanel then return end
    selectedPlayer = player
    lastSelectedPlayerName = player.Name

    for _, child in ipairs(rightPanel:GetChildren()) do
        if child:IsA("Frame") or child:IsA("TextLabel") or child:IsA("TextButton") then child:Destroy() end
    end

    local info = Instance.new("Frame")
    info.Size = UDim2.new(1, -20, 0, 130)
    info.Position = UDim2.new(0, 10, 0, 10)
    info.BackgroundColor3 = COLOR_ACCENT
    info.BorderSizePixel = 0
    Instance.new("UICorner", info).CornerRadius = CORNER_RADIUS
    info.Parent = rightPanel

    local nameLbl = Instance.new("TextLabel")
    nameLbl.Size = UDim2.new(0.6, -10, 0, 30)
    nameLbl.Position = UDim2.new(0, 10, 0, 10)
    nameLbl.BackgroundTransparency = 1
    nameLbl.Text = "Name: " .. player.DisplayName
    nameLbl.TextColor3 = COLOR_TEXT
    nameLbl.TextXAlignment = Enum.TextXAlignment.Left
    nameLbl.Font = FONT
    nameLbl.Parent = info

    local copyName = Instance.new("TextButton")
    copyName.Size = UDim2.new(0, 80, 0, 30)
    copyName.Position = UDim2.new(0.6, 10, 0, 10)
    copyName.Text = "Kopieren"
    copyName.BackgroundColor3 = COLOR_BUTTON
    copyName.TextColor3 = COLOR_TEXT
    copyName.Font = FONT
    Instance.new("UICorner", copyName).CornerRadius = CORNER_RADIUS
    copyName.MouseButton1Click:Connect(function() copyToClipboard(player.DisplayName) end)
    copyName.Parent = info

    local idLbl = Instance.new("TextLabel")
    idLbl.Size = UDim2.new(0.6, -10, 0, 30)
    idLbl.Position = UDim2.new(0, 10, 0, 50)
    idLbl.BackgroundTransparency = 1
    idLbl.Text = "UserID: " .. player.UserId
    idLbl.TextColor3 = COLOR_TEXT
    idLbl.TextXAlignment = Enum.TextXAlignment.Left
    idLbl.Font = FONT
    idLbl.Parent = info

    local copyId = Instance.new("TextButton")
    copyId.Size = UDim2.new(0, 80, 0, 30)
    copyId.Position = UDim2.new(0.6, 10, 0, 50)
    copyId.Text = "Kopieren"
    copyId.BackgroundColor3 = COLOR_BUTTON
    copyId.TextColor3 = COLOR_TEXT
    Instance.new("UICorner", copyId).CornerRadius = CORNER_RADIUS
    copyId.MouseButton1Click:Connect(function() copyToClipboard(tostring(player.UserId)) end)
    copyId.Parent = info

    local ageLbl = Instance.new("TextLabel")
    ageLbl.Name = "AccountAgeLabel"
    ageLbl.Size = UDim2.new(1, -20, 0, 30)
    ageLbl.Position = UDim2.new(0, 10, 0, 90)
    ageLbl.BackgroundTransparency = 1
    ageLbl.Text = "Account-Alter: Lade..."
    ageLbl.TextColor3 = Color3.fromRGB(180,180,180)
    ageLbl.TextXAlignment = Enum.TextXAlignment.Left
    ageLbl.Font = FONT
    ageLbl.Parent = info

    fetchAccountAge(player, function(days)
        if ageLbl and ageLbl.Parent then
            ageLbl.Text = days >= 0 and ("Account-Alter: " .. days .. " Tage") or "Account-Alter: Nicht verfügbar"
        end
    end)

    local actions = {"Ban", "Kick", "Bring", "TP2", "Find"}
    local btnColors = {
        Color3.fromRGB(200,40,40), Color3.fromRGB(200,160,40),
        Color3.fromRGB(40,180,40), Color3.fromRGB(40,140,220),
        Color3.fromRGB(220,100,40)
    }
    local callbacks = {
        function() copyToClipboard("/ban " .. player.Name) end,
        function() copyToClipboard("/kick " .. player.Name) end,
        function() copyToClipboard("/bring " .. player.Name) end,
        function() copyToClipboard("/tpto " .. player.Name) end,
        function() startFind(player) end
    }

    for i = 1, 5 do
        local btn = Instance.new("TextButton")
        btn.Size = UDim2.new(0.18, -5, 0, 45)
        btn.Position = UDim2.new(0.02 + (i-1)*0.19, 0, 0, 160)
        btn.Text = actions[i]
        btn.BackgroundColor3 = btnColors[i]
        btn.TextColor3 = COLOR_TEXT
        btn.TextSize = 18
        btn.Font = FONT
        Instance.new("UICorner", btn).CornerRadius = CORNER_RADIUS
        btn.MouseButton1Click:Connect(callbacks[i])
        btn.Parent = rightPanel
    end

    if player ~= LocalPlayer then
        local watchBtn = Instance.new("TextButton")
        watchBtn.Size = UDim2.new(0.9, 0, 0, 45)
        watchBtn.Position = UDim2.new(0.05, 0, 0, 220)
        watchBtn.Text = "👁 Zuschauen"
        watchBtn.BackgroundColor3 = COLOR_INFO
        watchBtn.TextColor3 = COLOR_TEXT
        watchBtn.TextSize = 18
        watchBtn.Font = FONT
        Instance.new("UICorner", watchBtn).CornerRadius = CORNER_RADIUS
        watchBtn.MouseButton1Click:Connect(function() startWatching(player) end)
        watchBtn.Parent = rightPanel
    end

    if player == LocalPlayer then
        local yOff = 230
        local espBtn = Instance.new("TextButton")
        espBtn.Size = UDim2.new(0.4, -10, 0, 45)
        espBtn.Position = UDim2.new(0.05, 0, 0, yOff)
        espBtn.Text = espActive and "ESP: AN" or "ESP: AUS"
        espBtn.BackgroundColor3 = espActive and COLOR_SUCCESS or COLOR_BUTTON
        espBtn.TextColor3 = COLOR_TEXT
        Instance.new("UICorner", espBtn).CornerRadius = CORNER_RADIUS
        espBtn.MouseButton1Click:Connect(function()
            espActive = not espActive
            espBtn.Text = espActive and "ESP: AN" or "ESP: AUS"
            espBtn.BackgroundColor3 = espActive and COLOR_SUCCESS or COLOR_BUTTON
            updateAllESP()
        end)
        espBtn.Parent = rightPanel

        local afkBtn = Instance.new("TextButton")
        afkBtn.Size = UDim2.new(0.4, -10, 0, 45)
        afkBtn.Position = UDim2.new(0.55, 0, 0, yOff)
        afkBtn.Text = antiAFKActive and "Anti-AFK: AN" or "Anti-AFK: AUS"
        afkBtn.BackgroundColor3 = antiAFKActive and COLOR_SUCCESS or COLOR_BUTTON
        afkBtn.TextColor3 = COLOR_TEXT
        Instance.new("UICorner", afkBtn).CornerRadius = CORNER_RADIUS
        afkBtn.MouseButton1Click:Connect(function()
            local newState = not antiAFKActive
            setAntiAFK(newState)
            afkBtn.Text = newState and "Anti-AFK: AN" or "Anti-AFK: AUS"
            afkBtn.BackgroundColor3 = newState and COLOR_SUCCESS or COLOR_BUTTON
        end)
        afkBtn.Parent = rightPanel

        local stopBtn = Instance.new("TextButton")
        stopBtn.Size = UDim2.new(0.9, 0, 0, 55)
        stopBtn.Position = UDim2.new(0.05, 0, 0, yOff + 70)
        stopBtn.Text = "Script beenden"
        stopBtn.BackgroundColor3 = COLOR_DANGER
        stopBtn.TextColor3 = COLOR_TEXT
        stopBtn.TextSize = 20
        stopBtn.Font = FONT
        Instance.new("UICorner", stopBtn).CornerRadius = CORNER_RADIUS
        stopBtn.MouseButton1Click:Connect(function()
            scriptRunning = false
            if mainGui then mainGui:Destroy() end
            stopFind()
            stopWatching()
            setAntiAFK(false)
            espActive = false
            updateAllESP()
            singletonFolder:Destroy()
        end)
        stopBtn.Parent = rightPanel
    end
end

-- ===== SPIELERLISTE (links) =====
local function buildPlayerList(scrollFrame, searchText)
    for _, child in ipairs(scrollFrame:GetChildren()) do
        if child:IsA("TextButton") then child:Destroy() end
    end

    local players = Players:GetPlayers()
    table.sort(players, function(a,b)
        if a == LocalPlayer then return true end
        if b == LocalPlayer then return false end
        return a.DisplayName < b.DisplayName
    end)

    local filter = string.lower(searchText or "")
    local y = 0
    for _, p in ipairs(players) do
        if filter == "" or string.find(string.lower(p.DisplayName), filter) or string.find(string.lower(p.Name), filter) or string.find(tostring(p.UserId), filter) then
            local btn = Instance.new("TextButton")
            btn.Size = UDim2.new(1, -10, 0, 40)
            btn.Position = UDim2.new(0, 5, 0, y)
            btn.BackgroundColor3 = getTeamColor(p)
            btn.Text = p.DisplayName .. " (" .. p.Name .. ")"
            btn.TextColor3 = COLOR_TEXT
            btn.TextSize = 14
            btn.Font = FONT
            Instance.new("UICorner", btn).CornerRadius = CORNER_RADIUS
            btn.MouseButton1Click:Connect(function() showPlayerDetails(p) end)
            btn.Parent = scrollFrame
            y = y + 45
        end
    end
    scrollFrame.CanvasSize = UDim2.new(0, 0, 0, y + 10)
end

-- ===== HAUPTMENÜ =====
local function openMenu()
    if mainGui then mainGui:Destroy() end
    mainGui = Instance.new("ScreenGui")
    mainGui.Name = "PremiumAdmin"
    mainGui.ResetOnSpawn = false
    mainGui.Parent = coreGui

    local mainFrame = Instance.new("Frame")
    mainFrame.Size = UDim2.new(0.9, 0, 0.9, 0)
    mainFrame.Position = UDim2.new(0.05, 0, 0.05, 0)
    mainFrame.BackgroundColor3 = COLOR_BG
    mainFrame.BackgroundTransparency = 0.1
    mainFrame.BorderSizePixel = 0
    Instance.new("UICorner", mainFrame).CornerRadius = UDim.new(0, 16)
    mainFrame.Parent = mainGui

    local leftPanel = Instance.new("Frame")
    leftPanel.Size = UDim2.new(0.3, -10, 1, -20)
    leftPanel.Position = UDim2.new(0, 10, 0, 10)
    leftPanel.BackgroundColor3 = COLOR_PANEL
    leftPanel.BorderSizePixel = 0
    Instance.new("UICorner", leftPanel).CornerRadius = CORNER_RADIUS
    leftPanel.Parent = mainFrame

    local searchBox = Instance.new("TextBox")
    searchBox.Size = UDim2.new(1, -20, 0, 35)
    searchBox.Position = UDim2.new(0, 10, 0, 10)
    searchBox.PlaceholderText = "Suchen (Name, ID)..."
    searchBox.Text = ""
    searchBox.BackgroundColor3 = COLOR_ACCENT
    searchBox.TextColor3 = COLOR_TEXT
    searchBox.PlaceholderColor3 = Color3.fromRGB(150,150,150)
    searchBox.Font = FONT
    Instance.new("UICorner", searchBox).CornerRadius = CORNER_RADIUS
    searchBox.Parent = leftPanel

    local scrollFrame = Instance.new("ScrollingFrame")
    scrollFrame.Size = UDim2.new(1, 0, 1, -55)
    scrollFrame.Position = UDim2.new(0, 0, 0, 55)
    scrollFrame.BackgroundTransparency = 1
    scrollFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
    scrollFrame.ScrollBarThickness = 6
    scrollFrame.ScrollBarImageColor3 = Color3.fromRGB(100,100,100)
    scrollFrame.Parent = leftPanel

    rightPanel = Instance.new("Frame")
    rightPanel.Size = UDim2.new(0.7, -20, 1, -20)
    rightPanel.Position = UDim2.new(0.3, 10, 0, 10)
    rightPanel.BackgroundColor3 = COLOR_PANEL
    rightPanel.BorderSizePixel = 0
    Instance.new("UICorner", rightPanel).CornerRadius = CORNER_RADIUS
    rightPanel.Parent = mainFrame

    local placeholder = Instance.new("TextLabel")
    placeholder.Size = UDim2.new(1, 0, 1, 0)
    placeholder.BackgroundTransparency = 1
    placeholder.Text = "👈 Wähle einen Spieler"
    placeholder.TextColor3 = Color3.fromRGB(200,200,200)
    placeholder.TextSize = 20
    placeholder.Font = FONT
    placeholder.Parent = rightPanel

    local closeBtn = Instance.new("TextButton")
    closeBtn.Size = UDim2.new(0, 40, 0, 40)
    closeBtn.Position = UDim2.new(1, -50, 0, 15)
    closeBtn.Text = "✕"
    closeBtn.TextSize = 24
    closeBtn.BackgroundColor3 = COLOR_DANGER
    closeBtn.TextColor3 = COLOR_TEXT
    Instance.new("UICorner", closeBtn).CornerRadius = UDim.new(1,0)
    closeBtn.Parent = mainFrame
    closeBtn.MouseButton1Click:Connect(function() mainGui:Destroy() end)

    local function refresh()
        buildPlayerList(scrollFrame, searchBox.Text)
    end

    searchBox:GetPropertyChangedSignal("Text"):Connect(refresh)
    Players.PlayerAdded:Connect(refresh)
    Players.PlayerRemoving:Connect(refresh)
    refresh()

    if lastSelectedPlayerName then
        for _, p in ipairs(Players:GetPlayers()) do
            if p.Name == lastSelectedPlayerName then
                showPlayerDetails(p)
                break
            end
        end
    end
end

-- ===== START =====
local dot = Instance.new("Frame")
dot.Size = UDim2.new(0, 12, 0, 12)
dot.Position = UDim2.new(0, 10, 0, 10)
dot.BackgroundColor3 = COLOR_TEXT
dot.BorderSizePixel = 0
Instance.new("UICorner", dot).CornerRadius = UDim.new(1,0)
dot.Parent = coreGui
task.wait(2)
dot:Destroy()

UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if gameProcessed then return end
    if input.KeyCode == Enum.KeyCode.F2 then
        if mainGui then mainGui:Destroy() mainGui = nil else openMenu() end
    end
end)

while scriptRunning do task.wait(1) end
