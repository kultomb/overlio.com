// Get tenant ID from URL or localStorage
const pathParts = window.location.pathname.split('/').filter(part => part);
let tenantId = pathParts[0];

// If no tenantId in URL, try to get from localStorage
if (!tenantId) {
    tenantId = localStorage.getItem('tenantId');
}

// Flag to track if we're currently updating lineups
let isUpdatingLineups = false;

// Check authentication from localStorage
const checkAuth = async () => {
    const storedTenantId = localStorage.getItem('tenantId');
    const storedUsername = localStorage.getItem('username');
    
    if (!storedTenantId || !storedUsername || storedTenantId !== tenantId) {
        window.location.href = '/login';
        return false;
    }
    
    try {
        const response = await fetch('/api/check-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: storedTenantId, username: storedUsername })
        });
        
        if (!response.ok) {
            localStorage.removeItem('tenantId');
            localStorage.removeItem('username');
            window.location.href = '/login';
            return false;
        }
        
        const data = await response.json();
        if (!data.authenticated) {
            localStorage.removeItem('tenantId');
            localStorage.removeItem('username');
            window.location.href = '/login';
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/login';
        return false;
    }
};

// Initialize authentication check
checkAuth().then(isAuthenticated => {
    if (isAuthenticated) {
        // Continue with the rest of the admin panel initialization
        console.log('Authentication successful, initializing admin panel...');
        
        // Initialize admin panel
        console.log('Admin panel DOM loaded for tenant:', tenantId);
        
        // Debug: Check if elements exist
        console.log('Elements check:', {
            leftTeamName: !!leftTeamName,
            rightTeamName: !!rightTeamName,
            leftScore: !!leftScore,
            rightScore: !!rightScore,
            matchTime: !!matchTime
        });
        
        if (leftTeamName) leftTeamName.value = 'HOME';
        if (rightTeamName) rightTeamName.value = 'AWAY';
        if (leftScore) leftScore.value = '0';
        if (rightScore) rightScore.value = '0';
        if (matchTime) matchTime.value = '00:00';
        
        // Request lineup data from server instead of setting defaults
        socket.emit('requestLineupData');
        
        // Initialize lineups and dropdowns after receiving data
        // updateLineups() will be called after receiving lineupData from server
        
        // Ensure all dropdowns are updated after a short delay
        // Note: updateTeamDropdowns and updatePlayerDropdowns will be called after receiving lineupData
        setTimeout(() => {
            updateDynamicButtonLabels();
        }, 100);
        
        // Add event listeners for time controls
        if (addedTime) {
            addedTime.addEventListener('change', () => {
                updateTime();
                // Update penalty overlay when added time changes
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }
        if (matchTime) {
            matchTime.addEventListener('input', () => {
                updateTime();
                // Update penalty overlay when time changes
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }
                if (period) {
            period.addEventListener('change', () => {
                updateTime();
                // Auto-show penalty overlay when period is "Penalty Shootout"
                if (period.value === 'Penalty Shootout' && !penaltyVisible) {
                    togglePenalty();
                } else if (period.value !== 'Penalty Shootout' && penaltyVisible) {
                    togglePenalty();
                    // Reset penalties when leaving penalty shootout
                    resetPenalties();
                }
                
                // Update penalty overlay when period changes
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }
        if (fieldType) {
            fieldType.addEventListener('change', () => {
                updateTime();
                // Update penalty overlay when field type changes
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }

        // Add event listeners for score changes to update penalty
        const leftScoreInput = document.getElementById('leftScore');
        const rightScoreInput = document.getElementById('rightScore');
        if (leftScoreInput) {
            leftScoreInput.addEventListener('input', () => {
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }
        if (rightScoreInput) {
            rightScoreInput.addEventListener('input', () => {
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }

        // Add event listeners for team name changes to update penalty
        const leftTeamNameInput = document.getElementById('leftTeamName');
        const rightTeamNameInput = document.getElementById('rightTeamName');
        if (leftTeamNameInput) {
            leftTeamNameInput.addEventListener('input', () => {
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }
        if (rightTeamNameInput) {
            rightTeamNameInput.addEventListener('input', () => {
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }

        // Add event listeners for team color changes to update penalty
        const leftTeamColorInput = document.getElementById('leftTeamColor');
        const rightTeamColorInput = document.getElementById('rightTeamColor');
        const leftTeamColor2Input = document.getElementById('leftTeamColor2');
        const rightTeamColor2Input = document.getElementById('rightTeamColor2');
        if (leftTeamColorInput) {
            leftTeamColorInput.addEventListener('change', () => {
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }
        if (rightTeamColorInput) {
            rightTeamColorInput.addEventListener('change', () => {
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }
        if (leftTeamColor2Input) {
            leftTeamColor2Input.addEventListener('change', () => {
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }
        if (rightTeamColor2Input) {
            rightTeamColor2Input.addEventListener('change', () => {
                if (penaltyVisible) {
                    updatePenaltyOverlay();
                }
            });
        }
        
        console.log('Admin panel initialized');
        // ĐƠN GIẢN: Tenant đã online khi login thành công, không cần gọi thêm
    }
});

// ĐƠN GIẢN: Không cần gọi API, tenant đã online khi login thành công

// Connect to Socket.IO server with tenant ID in handshake
const socket = io({
    query: {
        tenantId: tenantId
    }
});

// DOM elements
const connectionStatus = document.getElementById('connectionStatus');
const leftTeamName = document.getElementById('leftTeamName');
const rightTeamName = document.getElementById('rightTeamName');
const leftTeamColor = document.getElementById('leftTeamColor');
const rightTeamColor = document.getElementById('rightTeamColor');
const leftTeamColor2 = document.getElementById('leftTeamColor2');
const rightTeamColor2 = document.getElementById('rightTeamColor2');

const leftScore = document.getElementById('leftScore');
const rightScore = document.getElementById('rightScore');
const scoreBtnLeft = document.getElementById('scoreBtnLeft');
const scoreBtnRight = document.getElementById('scoreBtnRight');
const matchTime = document.getElementById('matchTime');
const period = document.getElementById('period');
const fieldType = document.getElementById('fieldType');
const addedTime = document.getElementById('addedTime');
const jumpTime = document.getElementById('jumpTime');
const startTimerBtn = document.getElementById('startTimerBtn');
const pauseTimerBtn = document.getElementById('pauseTimerBtn');
const timerToggleBtn = document.getElementById('timerToggleBtn');
const homeCardTitle = document.getElementById('homeCardTitle');
const awayCardTitle = document.getElementById('awayCardTitle');
let isTimerRunning = false;

// Lineup management elements
const leftTeamLineup = document.getElementById('leftTeamLineup');
const rightTeamLineup = document.getElementById('rightTeamLineup');

// Card management elements
const homeCardPlayer = document.getElementById('homeCardPlayer');
const awayCardPlayer = document.getElementById('awayCardPlayer');

// Substitution management elements - removed old elements, now using separate home/away dropdowns

// Sponsor management elements
const sponsorLabel = document.getElementById('sponsorLabel');
const sponsorText = document.getElementById('sponsorText');
const sponsorToggleBtn = document.getElementById('sponsorToggleBtn');

// Lineup data storage
let leftTeamPlayers = [];
let rightTeamPlayers = [];
let leftTeamCoach = '';
let rightTeamCoach = '';

// Connection status
socket.on('connect', () => {
    console.log('Admin panel connected to server for tenant:', tenantId);
    if (connectionStatus) {
        connectionStatus.className = 'status-indicator status-connected';
    }
    socket.emit('requestInitialData');
    socket.emit('requestLineupData'); // Request lineup data when connecting
    
    // Initialize card team titles and score button colors with current values
    updateTeamDropdowns();
    updatePlayerDropdowns();
    updateScoreButtonColors();
    updateDynamicButtonLabels();
    
    // Force load players from current lineup data
    setTimeout(() => {
        updateLineupsUI();
        updatePlayerDropdowns();
    }, 500);
});

socket.on('disconnect', () => {
    console.log('Admin panel disconnected from server');
    if (connectionStatus) {
        connectionStatus.className = 'status-indicator status-disconnected';
    }
});

socket.on('connect_error', (error) => {
    console.error('Admin panel connection error:', error);
    if (connectionStatus) {
        connectionStatus.className = 'status-indicator status-disconnected';
    }
});

// Listen for updates from server
socket.on('scoreUpdate', (data) => {
    console.log('Admin received score update:', data);
    if (leftScore && rightScore) {
        leftScore.value = data.leftScore;
        rightScore.value = data.rightScore;
    }
});

socket.on('teamUpdate', (data) => {
    console.log('Admin received team update:', data);
    if (leftTeamName && rightTeamName) {
        // Ensure team names are always uppercase
        leftTeamName.value = data.leftTeam.toUpperCase();
        rightTeamName.value = data.rightTeam.toUpperCase();
        
        // Update all team titles and dropdowns when receiving team data
        updateAllTeamTitles();
        updateTeamDropdowns();
    }
});

socket.on('colorUpdate', (data) => {
    console.log('Admin received color update:', data);
    leftTeamColor.value = data.leftColor;
    rightTeamColor.value = data.rightColor;
    
    // Update card team titles and score button colors when receiving color data
    updateTeamDropdowns();
    updateScoreButtonColors();
});

// Socket event listeners
socket.on('timeUpdate', (data) => {
    console.log('Time update received from server:', data);
    // Cập nhật thời gian hiển thị trên admin panel
    matchTime.value = data.time;
    period.value = data.period;
    if (data.addedTime) {
        addedTime.value = data.addedTime;
    }
    // Cập nhật fieldType nếu có
    if (data.fieldType) {
        fieldType.value = data.fieldType;
    }
});

socket.on('timerStatus', (data) => {
    console.log('Timer status received:', data);
    updateTimerButtons(data.isRunning);
});

// Listen for lineup data from server
socket.on('lineupData', (data) => {
    console.log('Admin received lineup data:', data);
    
    // Don't update textareas if we're currently in the middle of an update
    if (isUpdatingLineups) {
        console.log('Skipping lineup data update - currently updating lineups');
        return;
    }
    
    // Convert lineup data back to text format for textareas
    const formatLineupToText = (teamData) => {
        let text = '';
        
        // Add coach if exists
        if (teamData.coach) {
            text += `#${teamData.coach}\n`;
        }
        
        // Add starting players
        if (teamData.startingPlayers && teamData.startingPlayers.length > 0) {
            teamData.startingPlayers.forEach(player => {
                text += `${player.name} ${player.number}\n`;
            });
        }
        
        // Add empty line to separate starting and substitute players
        if (teamData.substitutePlayers && teamData.substitutePlayers.length > 0) {
            text += '\n';
            
            // Add substitute players
            teamData.substitutePlayers.forEach(player => {
                text += `${player.name} ${player.number}\n`;
            });
        }
        
        return text.trim();
    };
    
    // Update textareas with received data (only if not currently updating)
    if (leftTeamLineup && data.homeTeam) {
        // Use original text if available, otherwise format from parsed data
        let leftText = data.homeTeam.originalText || formatLineupToText(data.homeTeam);
        // If no data from server, use default values
        if (!leftText.trim()) {
            leftTeamLineup.value = '#José Mourinho\nCristiano Ronaldo 7\nBruno Fernandes 18\nHarry Maguire 5\nMarcus Rashford 10\nPaul Pogba 6\nDavid de Gea 1';
        } else {
            leftTeamLineup.value = leftText;
        }
    }
    
    if (rightTeamLineup && data.awayTeam) {
        // Use original text if available, otherwise format from parsed data
        let rightText = data.awayTeam.originalText || formatLineupToText(data.awayTeam);
        // If no data from server, use default values
        if (!rightText.trim()) {
            rightTeamLineup.value = '#Pep Guardiola\nLionel Messi 10\nNeymar Jr 11\nKylian Mbappé 7\nMarquinhos 5\nMarco Verratti 6\nGianluigi Donnarumma 99';
        } else {
            rightTeamLineup.value = rightText;
        }
    }
    
    // Update dropdowns and other UI elements (without sending to server)
    updateLineupsUI();
    updateTeamDropdowns();
    updatePlayerDropdowns();
    updateDynamicButtonLabels();
    
    // Force update player dropdowns after a delay
    setTimeout(() => {
        console.log('Force updating player dropdowns...');
        updatePlayerDropdowns();
    }, 500);
    
    // Check if we need to save default data to server (first time use)
    const leftText = formatLineupToText(data.homeTeam);
    const rightText = formatLineupToText(data.awayTeam);
    
    if (!leftText.trim() || !rightText.trim()) {
        console.log('First time use detected, saving default lineup data to server');
        // Save default data to server
        setTimeout(() => {
            updateLineups();
        }, 500);
    }
    
    console.log('Lineup data loaded and UI updated');
});

// Color picker event listeners
leftTeamColor.addEventListener('input', (e) => {
    updateScoreButtonColors();
});
rightTeamColor.addEventListener('input', (e) => {
    updateScoreButtonColors();
});

// Dropdown event listeners
homeCardPlayer.addEventListener('change', (e) => {
    console.log('Home card player changed:', e.target.value);
});

awayCardPlayer.addEventListener('change', (e) => {
    console.log('Away card player changed:', e.target.value);
});





// Team functions
const updateTeams = () => {
    // Ensure team names are always uppercase but preserve spaces
    const leftTeam = (leftTeamName.value || 'HOME').toUpperCase();
    const rightTeam = (rightTeamName.value || 'AWAY').toUpperCase();
    const leftColor = leftTeamColor.value;
    const rightColor = rightTeamColor.value;
    const leftColor2 = leftTeamColor2.value;
    const rightColor2 = rightTeamColor2.value;
    console.log('Sending team update:', { leftTeam, rightTeam, leftColor, rightColor, leftColor2, rightColor2 });
    socket.emit('updateTeams', { leftTeam, rightTeam, leftColor, rightColor, leftColor2, rightColor2 });
    
    // Update input fields to show uppercase
    leftTeamName.value = leftTeam;
    rightTeamName.value = rightTeam;
    
    // Update all team labels and titles
    updateAllTeamTitles();
    updateTeamDropdowns();
    updatePlayerDropdowns();
    updateScoreButtonColors();
    updateDynamicButtonLabels();
    
    showNotification('Teams updated successfully!');
    
    // Update penalty overlay if visible
    if (penaltyVisible) {
        updatePenaltyOverlay();
    }
};

// Score functions
const updateScores = () => {
    const left = parseInt(leftScore.value) || 0;
    const right = parseInt(rightScore.value) || 0;
    console.log('Sending score update:', { left, right });
    socket.emit('updateScores', { leftScore: left, rightScore: right });
    showNotification('Scores updated successfully!');
    
    // Update penalty overlay if visible
    if (penaltyVisible) {
        updatePenaltyOverlay();
    }
};

const incrementScore = (side) => {
    const scoreElement = side === 'left' ? leftScore : rightScore;
    const currentScore = parseInt(scoreElement.value) || 0;
    scoreElement.value = currentScore + 1;
    updateScores();
    
    // Update penalty overlay if visible
    if (penaltyVisible) {
        updatePenaltyOverlay();
    }
};

const decrementScore = (side) => {
    const scoreElement = side === 'left' ? leftScore : rightScore;
    const currentScore = parseInt(scoreElement.value) || 0;
    if (currentScore > 0) {
        scoreElement.value = currentScore - 1;
        updateScores();
        
        // Update penalty overlay if visible
        if (penaltyVisible) {
            updatePenaltyOverlay();
        }
    }
};

const resetScores = () => {
    leftScore.value = 0;
    rightScore.value = 0;
    updateScores();
    
    // Update penalty overlay if visible
    if (penaltyVisible) {
        updatePenaltyOverlay();
    }
};

// Time functions
const updateTime = () => {
    const time = matchTime.value.trim() || '00:00';
    const periodText = period.value;
    const addedTimeValue = addedTime.value || '+0';
    const fieldTypeValue = fieldType.value;
    
    if (!/^[0-9]+:[0-9]{2}$/.test(time)) {
        showNotification('Invalid time format. Use MM:SS or MMM:SS', 'error');
        return;
    }
    
    const timeToSend = time;
    
    socket.emit('timeUpdate', { 
        time: timeToSend, 
        period: periodText, 
        addedTime: addedTimeValue, 
        fieldType: fieldTypeValue 
    });
    showNotification('Time updated successfully!');
    if (isTimerRunning) {
        startTimer();
    }
};

// Field type and period logic
const updatePeriodOptions = () => {
    const selectedField = fieldType.value;
    const currentPeriod = period.value;
    
    // Reset to 1st half when changing field type
    period.value = '1st Half';
    matchTime.value = '00:00';
    // Giữ nguyên giá trị bù giờ người dùng đã chọn
};

const updateTimeOnPeriodChange = () => {
    const selectedField = fieldType.value;
    const selectedPeriod = period.value;
    let periodMinutes = 0;
    
    switch (selectedPeriod) {
        case '1st Half':
            if (selectedField === '5') periodMinutes = 20;
            else if (selectedField === '7') periodMinutes = 35;
            else if (selectedField === '7-30') periodMinutes = 30;
            else if (selectedField === '11') periodMinutes = 45;
            else periodMinutes = 45;
            matchTime.value = '00:00';
            break;
        case '2nd Half':
            if (selectedField === '5') periodMinutes = 20;
            else if (selectedField === '7') periodMinutes = 35;
            else if (selectedField === '7-30') periodMinutes = 30;
            else if (selectedField === '11') periodMinutes = 45;
            else periodMinutes = 45;
            matchTime.value = periodMinutes.toString().padStart(2, '0') + ':00';
            break;
        case 'Extra Time 1st Half':
            periodMinutes = 15;
            if (selectedField === '11') {
                matchTime.value = '90:00'; // 45+45 = 90 phút
            } else if (selectedField === '7') {
                matchTime.value = '70:00'; // 35+35 = 70 phút
            } else if (selectedField === '7-30') {
                matchTime.value = '60:00'; // 30+30 = 60 phút
            } else if (selectedField === '5') {
                matchTime.value = '40:00'; // 20+20 = 40 phút
            } else {
                matchTime.value = '00:00';
            }
            break;
        case 'Extra Time 2nd Half':
            periodMinutes = 15;
            if (selectedField === '11') {
                matchTime.value = '105:00'; // 45+45+15 = 105 phút
            } else if (selectedField === '7') {
                matchTime.value = '85:00'; // 35+35+15 = 85 phút
            } else if (selectedField === '7-30') {
                matchTime.value = '75:00'; // 30+30+15 = 75 phút
            } else if (selectedField === '5') {
                matchTime.value = '55:00'; // 20+20+15 = 55 phút
            } else {
                matchTime.value = '00:00';
            }
            break;
        case 'Penalty Shootout':
            periodMinutes = 0;
            matchTime.value = '00:00';
            break;
        default:
            periodMinutes = 45;
            matchTime.value = '00:00';
    }
    updateTime();
    // Giữ nguyên giá trị bù giờ người dùng đã chọn
};

// Timer functions
const toggleTimer = () => {
    if (isTimerRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
};

const startTimer = () => {
    console.log('Starting timer');
    socket.emit('startTimer');
    showNotification('Timer started!');
};

const pauseTimer = () => {
    console.log('Pausing timer');
    socket.emit('pauseTimer');
    showNotification('Timer paused!');
};

const resetTimer = () => {
    console.log('Resetting timer');
    socket.emit('resetTimer');
    showNotification('Timer reset!');
};

const updateTimerButtons = (running) => {
    isTimerRunning = running;
    if (running) {
        timerToggleBtn.textContent = '⏸️ Pause';
        timerToggleBtn.classList.remove('btn-success');
        timerToggleBtn.classList.add('btn-warning');
    } else {
        timerToggleBtn.textContent = '▶️ Start';
        timerToggleBtn.classList.remove('btn-warning');
        timerToggleBtn.classList.add('btn-success');
    }
};

const jumpToTime = () => {
    const jumpTimeValue = jumpTime.value.trim() || '00:00';
    if (!/^[0-9]+:[0-9]{2}$/.test(jumpTimeValue)) {
        showNotification('Invalid time format. Use MM:SS or MMM:SS', 'error');
        return;
    }
    
    // Chuyển thời gian hiện tại về thời gian mong muốn
    matchTime.value = jumpTimeValue;
    
    // Cập nhật thời gian lên server
    const periodText = period.value;
    const addedTimeValue = addedTime.value || '+0';
    const fieldTypeValue = fieldType.value;
    
    socket.emit('timeUpdate', { 
        time: jumpTimeValue, 
        period: periodText, 
        addedTime: addedTimeValue, 
        fieldType: fieldTypeValue 
    });
    
    // Bắt đầu timer ngay lập tức
    setTimeout(() => {
        socket.emit('startTimer');
    }, 100);
    
    // Reset ô input Jump to Time về 00:00 để dễ sử dụng cho lần sau
    jumpTime.value = '00:00';
    
    showNotification(`Jumped to ${jumpTimeValue} and started timer!`);
};

// Sponsor functions
const updateSponsor = () => {
    const label = sponsorLabel.value.trim() || 'NHÀ TÀI TRỢ';
    const text = sponsorText.value.trim() || 'Chào mừng đến với trận đấu hôm nay!';
    
    console.log('Sending sponsor update:', { label, text });
    socket.emit('updateSponsor', { label, text });
    showNotification('Sponsor updated successfully!');
};

const showSponsor = () => {
    console.log('Show sponsor overlay');
    socket.emit('showSponsor');
    sponsorToggleBtn.textContent = '🙈 Hide';
    sponsorToggleBtn.classList.remove('btn-success');
    sponsorToggleBtn.classList.add('btn-danger');
    showNotification('Sponsor overlay shown!');
};

const hideSponsor = () => {
    console.log('Hide sponsor overlay');
    socket.emit('hideSponsor');
    sponsorToggleBtn.textContent = '👁️ Show';
    sponsorToggleBtn.classList.remove('btn-danger');
    sponsorToggleBtn.classList.add('btn-success');
    showNotification('Sponsor overlay hidden!');
};

const toggleSponsor = () => {
    if (sponsorToggleBtn.textContent.includes('Hide')) {
        hideSponsor();
    } else {
        showSponsor();
    }
};

// Lineup management functions
const parseLineup = (lineupText) => {
    const allPlayers = [];
    const startingPlayers = [];
    const substitutePlayers = [];
    let coach = '';
    const lines = lineupText.trim().split('\n');
    let isStartingLineup = true;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            // Check if line starts with # (coach)
            if (trimmedLine.startsWith('#')) {
                coach = trimmedLine.substring(1).trim();
            } else {
                // Split by last space to separate name and number
                const lastSpaceIndex = trimmedLine.lastIndexOf(' ');
                if (lastSpaceIndex > 0) {
                    const name = trimmedLine.substring(0, lastSpaceIndex).trim();
                    const number = trimmedLine.substring(lastSpaceIndex + 1).trim();
                    if (name && number) {
                        const player = { name, number };
                        allPlayers.push(player);
                        
                        // Add to starting lineup if we're still in starting section
                        if (isStartingLineup) {
                            startingPlayers.push(player);
                        } else {
                            substitutePlayers.push(player);
                        }
                    }
                }
            }
        } else {
            // Empty line indicates transition from starting to substitute players
            isStartingLineup = false;
        }
    }
    
    return { 
        players: allPlayers, 
        startingPlayers: startingPlayers,
        substitutePlayers: substitutePlayers,
        coach 
    };
};

// Function to update UI only (without sending to server)
const updateLineupsUI = () => {
    const leftLineupText = leftTeamLineup.value.trim();
    const rightLineupText = rightTeamLineup.value.trim();
    
    const leftLineupData = parseLineup(leftLineupText);
    const rightLineupData = parseLineup(rightLineupText);
    
    // Store all players for dropdowns
    leftTeamPlayers = leftLineupData.players;
    rightTeamPlayers = rightLineupData.players;
    
    // Store coach information
    leftTeamCoach = leftLineupData.coach;
    rightTeamCoach = rightLineupData.coach;
    
    console.log('Parsed lineups for UI update:', { 
        leftTeamPlayers, 
        rightTeamPlayers, 
        leftTeamCoach, 
        rightTeamCoach,
        leftStartingPlayers: leftLineupData.startingPlayers,
        rightStartingPlayers: rightLineupData.startingPlayers,
        leftSubstitutePlayers: leftLineupData.substitutePlayers,
        rightSubstitutePlayers: rightLineupData.substitutePlayers
    });
};

const updateLineups = () => {
    // Set flag to prevent overwriting user input
    isUpdatingLineups = true;
    
    const leftLineupText = leftTeamLineup.value.trim();
    const rightLineupText = rightTeamLineup.value.trim();
    
    const leftLineupData = parseLineup(leftLineupText);
    const rightLineupData = parseLineup(rightLineupText);
    
    // Store all players for dropdowns
    leftTeamPlayers = leftLineupData.players;
    rightTeamPlayers = rightLineupData.players;
    
    // Store coach information
    leftTeamCoach = leftLineupData.coach;
    rightTeamCoach = rightLineupData.coach;
    
    console.log('Parsed lineups:', { 
        leftTeamPlayers, 
        rightTeamPlayers, 
        leftTeamCoach, 
        rightTeamCoach,
        leftStartingPlayers: leftLineupData.startingPlayers,
        rightStartingPlayers: rightLineupData.startingPlayers,
        leftSubstitutePlayers: leftLineupData.substitutePlayers,
        rightSubstitutePlayers: rightLineupData.substitutePlayers
    });
    
    // Show notification with lineup summary
    const leftStartingCount = leftLineupData.startingPlayers.length;
    const rightStartingCount = rightLineupData.startingPlayers.length;
    
    showNotification(`Lineups updated! ${leftStartingCount} players (Left), ${rightStartingCount} players (Right)`);
    
    updateTeamDropdowns();
    updatePlayerDropdowns();
    
    // Send lineup data to server
    socket.emit('updateLineups', {
        leftTeamLineup: leftLineupText,
        rightTeamLineup: rightLineupText
    });
    
    console.log('Lineups updated:', { leftTeamPlayers, rightTeamPlayers, leftTeamCoach, rightTeamCoach });
    showNotification('Lineups updated successfully!');
    
    // Reset flag after a short delay to allow server response
    setTimeout(() => {
        isUpdatingLineups = false;
    }, 1000);
};

const updateScoreButtonColors = () => {
    const leftColor = leftTeamColor.value;
    const rightColor = rightTeamColor.value;
    
    // Update left score button color
    scoreBtnLeft.style.background = `linear-gradient(135deg, ${leftColor} 0%, ${adjustBrightness(leftColor, -20)} 100%)`;
    
    // Update right score button color
    scoreBtnRight.style.background = `linear-gradient(135deg, ${rightColor} 0%, ${adjustBrightness(rightColor, -20)} 100%)`;
};

const adjustBrightness = (hex, percent) => {
    // Convert hex to RGB
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    
    // Adjust brightness
    r = Math.max(0, Math.min(255, r + (r * percent / 100)));
    g = Math.max(0, Math.min(255, g + (g * percent / 100)));
    b = Math.max(0, Math.min(255, b + (b * percent / 100)));
    
    // Convert back to hex
    return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
};

const updateTeamDropdowns = () => {
    const leftTeam = (leftTeamName.value || 'HOME').toUpperCase();
    const rightTeam = (rightTeamName.value || 'AWAY').toUpperCase();
    
    console.log('Updating team dropdowns:', { leftTeam, rightTeam });
    
    // Update card team titles
    homeCardTitle.textContent = leftTeam;
    awayCardTitle.textContent = rightTeam;
    
    // Update goal team titles
    const homeGoalTitle = document.getElementById('homeGoalTitle');
    const awayGoalTitle = document.getElementById('awayGoalTitle');
    if (homeGoalTitle) homeGoalTitle.textContent = leftTeam;
    if (awayGoalTitle) awayGoalTitle.textContent = rightTeam;
    
    // Update substitution team titles
    const homeSubTitle = document.getElementById('homeSubTitle');
    const awaySubTitle = document.getElementById('awaySubTitle');
    if (homeSubTitle) homeSubTitle.textContent = leftTeam;
    if (awaySubTitle) awaySubTitle.textContent = rightTeam;
};

const updatePlayerDropdowns = () => {
    // Update card player dropdowns
    updateCardPlayerDropdowns();
    
    // Update substitution player dropdowns
    updateSubstitutionPlayerDropdowns();
    
    // Update goal player dropdowns
    updateGoalPlayerDropdowns();
    

};

const updateCardPlayerDropdowns = () => {
    console.log('Updating card player dropdowns...');
    console.log('homeCardPlayer element:', homeCardPlayer);
    console.log('awayCardPlayer element:', awayCardPlayer);
    console.log('leftTeamPlayers:', leftTeamPlayers);
    console.log('rightTeamPlayers:', rightTeamPlayers);
    
    // Update home team players
    if (homeCardPlayer) {
        homeCardPlayer.innerHTML = '<option value="">Select Player</option>';
        leftTeamPlayers.forEach(player => {
            const option = document.createElement('option');
            option.value = JSON.stringify(player);
            option.textContent = `${player.name} (${player.number})`;
            homeCardPlayer.appendChild(option);
        });
    } else {
        console.error('homeCardPlayer element not found!');
    }
    
    // Update away team players
    if (awayCardPlayer) {
        awayCardPlayer.innerHTML = '<option value="">Select Player</option>';
        rightTeamPlayers.forEach(player => {
            const option = document.createElement('option');
            option.value = JSON.stringify(player);
            option.textContent = `${player.name} (${player.number})`;
            awayCardPlayer.appendChild(option);
        });
    } else {
        console.error('awayCardPlayer element not found!');
    }
    
    console.log('Updated card player dropdowns:', { leftTeamPlayers, rightTeamPlayers });
};

const updateSubstitutionPlayerDropdowns = () => {
    // Update home team substitution dropdowns
    const homeSubPlayerOut = document.getElementById('homeSubPlayerOut');
    const homeSubPlayerIn = document.getElementById('homeSubPlayerIn');
    
    if (!homeSubPlayerOut || !homeSubPlayerIn) {
        console.error('Home substitution dropdowns not found');
        return;
    }
    
    homeSubPlayerOut.innerHTML = '<option value="">Select Player</option>';
    homeSubPlayerIn.innerHTML = '<option value="">Select Player</option>';
    
    leftTeamPlayers.forEach(player => {
        const option = document.createElement('option');
        option.value = JSON.stringify(player);
        option.textContent = `${player.name} (${player.number})`;
        homeSubPlayerOut.appendChild(option.cloneNode(true));
        homeSubPlayerIn.appendChild(option);
    });
    
    // Update away team substitution dropdowns
    const awaySubPlayerOut = document.getElementById('awaySubPlayerOut');
    const awaySubPlayerIn = document.getElementById('awaySubPlayerIn');
    
    if (!awaySubPlayerOut || !awaySubPlayerIn) {
        console.error('Away substitution dropdowns not found');
        return;
    }
    
    awaySubPlayerOut.innerHTML = '<option value="">Select Player</option>';
    awaySubPlayerIn.innerHTML = '<option value="">Select Player</option>';
    
    rightTeamPlayers.forEach(player => {
        const option = document.createElement('option');
        option.value = JSON.stringify(player);
        option.textContent = `${player.name} (${player.number})`;
        awaySubPlayerOut.appendChild(option.cloneNode(true));
        awaySubPlayerIn.appendChild(option);
    });
    
    console.log('Updated substitution player dropdowns:', { 
        leftTeamPlayers, 
        rightTeamPlayers,
        homeSubPlayerOut: !!homeSubPlayerOut,
        homeSubPlayerIn: !!homeSubPlayerIn,
        awaySubPlayerOut: !!awaySubPlayerOut,
        awaySubPlayerIn: !!awaySubPlayerIn
    });
};

const updateGoalPlayerDropdowns = () => {
    // Update home team players
    const homeGoalPlayer = document.getElementById('homeGoalPlayer');
    homeGoalPlayer.innerHTML = '<option value="">Select Player</option>';
    leftTeamPlayers.forEach(player => {
        const option = document.createElement('option');
        option.value = JSON.stringify(player);
        option.textContent = `${player.name} (${player.number})`;
        homeGoalPlayer.appendChild(option);
    });
    
    // Update away team players
    const awayGoalPlayer = document.getElementById('awayGoalPlayer');
    awayGoalPlayer.innerHTML = '<option value="">Select Player</option>';
    rightTeamPlayers.forEach(player => {
        const option = document.createElement('option');
        option.value = JSON.stringify(player);
        option.textContent = `${player.name} (${player.number})`;
        awayGoalPlayer.appendChild(option);
    });
    
    console.log('Updated goal player dropdowns:', { leftTeamPlayers, rightTeamPlayers });
};

// Card management functions
const showSelectedCard = (type, team) => {
    let selectedPlayerOption;
    let selectedTeam;
    let teamColor;
    
    if (team === 'home') {
        selectedPlayerOption = homeCardPlayer.value;
        selectedTeam = (leftTeamName.value || 'HOME').toUpperCase();
        teamColor = leftTeamColor.value;
    } else if (team === 'away') {
        selectedPlayerOption = awayCardPlayer.value;
        selectedTeam = (rightTeamName.value || 'AWAY').toUpperCase();
        teamColor = rightTeamColor.value;
    } else {
        showNotification('Invalid team selection', 'error');
        return;
    }
    
    if (!selectedPlayerOption) {
        showNotification('Please select a player', 'error');
        return;
    }
    
    const player = JSON.parse(selectedPlayerOption);
    const cardData = {
        type: type,
        player: player.name,
        team: selectedTeam,
        teamColor: teamColor,
        time: matchTime.value || '00:00',
        playerNumber: player.number
    };
    
    console.log('Showing selected card overlay:', cardData);
    // Add tenant ID to card data for multi-tenant support
    cardData.tenantId = tenantId;
    socket.emit('showCard', cardData);
    showNotification(`${type} card for ${player.name} shown!`);
};

// Substitution management functions
const showSelectedSubstitution = (team) => {
    let selectedPlayerOutOption;
    let selectedPlayerInOption;
    let selectedTeam;
    let teamColor;
    
    if (team === 'home') {
        selectedPlayerOutOption = document.getElementById('homeSubPlayerOut').value;
        selectedPlayerInOption = document.getElementById('homeSubPlayerIn').value;
        selectedTeam = (leftTeamName.value || 'HOME').toUpperCase();
        teamColor = leftTeamColor.value;
    } else if (team === 'away') {
        selectedPlayerOutOption = document.getElementById('awaySubPlayerOut').value;
        selectedPlayerInOption = document.getElementById('awaySubPlayerIn').value;
        selectedTeam = (rightTeamName.value || 'AWAY').toUpperCase();
        teamColor = rightTeamColor.value;
    } else {
        showNotification('Invalid team selection', 'error');
        return;
    }
    
    if (!selectedPlayerOutOption || !selectedPlayerInOption) {
        showNotification('Please select both players', 'error');
        return;
    }
    
    const playerOut = JSON.parse(selectedPlayerOutOption);
    const playerIn = JSON.parse(selectedPlayerInOption);
    
    const subData = {
        playerOut: playerOut.name,
        playerIn: playerIn.name,
        playerOutNumber: playerOut.number,
        playerInNumber: playerIn.number,
        team: selectedTeam,
        teamColor: teamColor,
        time: matchTime.value || '00:00',
        score: `${leftScore.value} - ${rightScore.value}`
    };
    
    console.log('Showing selected substitution overlay:', subData);
    // Add tenant ID to substitution data for multi-tenant support
    subData.tenantId = tenantId;
    socket.emit('showSubstitution', subData);
    showNotification(`Substitution: ${playerOut.name} → ${playerIn.name}`);
};

// Goal management functions
const showSelectedGoal = (team) => {
    let selectedPlayerOption;
    let selectedTeam;
    let teamColor;
    
    if (team === 'home') {
        selectedPlayerOption = document.getElementById('homeGoalPlayer').value;
        selectedTeam = (leftTeamName.value || 'HOME').toUpperCase();
        teamColor = leftTeamColor.value;
    } else if (team === 'away') {
        selectedPlayerOption = document.getElementById('awayGoalPlayer').value;
        selectedTeam = (rightTeamName.value || 'AWAY').toUpperCase();
        teamColor = rightTeamColor.value;
    } else {
        showNotification('Invalid team selection', 'error');
        return;
    }
    
    if (!selectedPlayerOption) {
        showNotification('Please select a player', 'error');
        return;
    }
    
    const player = JSON.parse(selectedPlayerOption);
    const goalData = {
        player: player.name,
        team: selectedTeam,
        teamColor: teamColor,
        time: matchTime.value || '00:00',
        playerNumber: player.number
    };
    
    console.log('Showing selected goal overlay:', goalData);
    // Add tenant ID to goal data for multi-tenant support
    goalData.tenantId = tenantId;
    socket.emit('showGoal', goalData);
    showNotification(`Goal scorer: ${player.name} from ${selectedTeam}`);
};



// Lineup overlay functions
const showLineupOverlay = (team) => {
    const leftTeam = (leftTeamName.value || 'HOME').toUpperCase();
    const rightTeam = (rightTeamName.value || 'AWAY').toUpperCase();
    
    // Parse current lineup data to get starting players
    const leftLineupData = parseLineup(leftTeamLineup.value.trim());
    const rightLineupData = parseLineup(rightTeamLineup.value.trim());
    
    let teamData;
    if (team === 'home') {
        teamData = {
            name: leftTeam,
            color: leftTeamColor.value,
            players: leftTeamPlayers, // All players for dropdown compatibility
            startingPlayers: leftLineupData.startingPlayers, // Starting lineup for display
            coach: leftTeamCoach,
            side: 'home'
        };
    } else if (team === 'away') {
        teamData = {
            name: rightTeam,
            color: rightTeamColor.value,
            players: rightTeamPlayers, // All players for dropdown compatibility
            startingPlayers: rightLineupData.startingPlayers, // Starting lineup for display
            coach: rightTeamCoach,
            side: 'away'
        };
            } else if (team === 'both') {
            // Show both teams lineup - use the general lineup overlay
            teamData = {
                name: `${leftTeam} vs ${rightTeam}`,
                color: leftTeamColor.value,
                players: leftTeamPlayers,
                coach: leftTeamCoach,
                side: 'both',
                homeTeam: {
                    name: leftTeam,
                    color: leftTeamColor.value,
                    playerList: leftTeamPlayers,
                    startingPlayers: leftLineupData.startingPlayers,
                    coach: leftTeamCoach
                },
                awayTeam: {
                    name: rightTeam,
                    color: rightTeamColor.value,
                    playerList: rightTeamPlayers,
                    startingPlayers: rightLineupData.startingPlayers,
                    coach: rightTeamCoach
                }
            };
    } else {
        showNotification('Invalid team selection', 'error');
        return;
    }
    
    console.log('Showing lineup overlay:', teamData);
    // Add tenant ID to lineup data for multi-tenant support
    teamData.tenantId = tenantId;
    
    if (team === 'both') {
        // For both teams, use the general lineup overlay
        socket.emit('showLineup', teamData);
        showNotification(`Both teams lineup overlay shown!`);
    } else {
        socket.emit('showLineup', teamData);
        showNotification(`${teamData.name} lineup overlay shown!`);
    }
};



// Utility functions
const showNotification = (message, type = 'success') => {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 8px;
        right: 8px;
        background: ${type === 'error' ? '#e74c3c' : '#27ae60'};
        color: white;
        padding: 6px 10px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        z-index: 1000;
        font-weight: 400;
        font-size: 11px;
        animation: slideIn 0.3s ease-out;
        max-width: 150px;
        word-wrap: break-word;
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 1500);
};

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch(e.key) {
            case '1': e.preventDefault(); incrementScore('left'); break;
            case '2': e.preventDefault(); incrementScore('right'); break;
            case 'r': e.preventDefault(); resetScores(); break;
            case 't': e.preventDefault(); updateTeams(); break;
        }
    }
});

// Auto-save functionality
let autoSaveTimer;
const scheduleAutoSave = () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        updateScores();
        updateTeams();
    }, 2000);
};

// Add event listeners for auto-save
[leftScore, rightScore].forEach(element => element.addEventListener('input', scheduleAutoSave));
[leftTeamName, rightTeamName].forEach(element => element.addEventListener('change', scheduleAutoSave));
[leftTeamColor, rightTeamColor].forEach(element => element.addEventListener('change', scheduleAutoSave));

function updateDynamicButtonLabels() {
    const leftName = (leftTeamName.value || 'HOME').toUpperCase();
    const rightName = (rightTeamName.value || 'AWAY').toUpperCase();
    const leftColor = leftTeamColor.value;
    const rightColor = rightTeamColor.value;
    
    // Update score button names
    document.getElementById('scoreBtnLeftName').textContent = leftName;
    document.getElementById('scoreBtnRightName').textContent = rightName;
    
    // Update lineup button names
    document.getElementById('lineupHomeBtnName').textContent = leftName;
    document.getElementById('lineupAwayBtnName').textContent = rightName;
    
    // Update lineup labels with team names and colors
    document.getElementById('leftTeamLabel').textContent = `${leftName}:`;
    document.getElementById('leftTeamLabel').style.color = leftColor;
    
    document.getElementById('rightTeamLabel').textContent = `${rightName}:`;
    document.getElementById('rightTeamLabel').style.color = rightColor;
    
    // Update card team titles with team names and colors
    document.getElementById('homeCardTitle').textContent = leftName;
    document.getElementById('homeCardTitle').style.color = leftColor;
    
    document.getElementById('awayCardTitle').textContent = rightName;
    document.getElementById('awayCardTitle').style.color = rightColor;
    
    // Update goal team titles with team names and colors
    document.getElementById('homeGoalTitle').textContent = leftName;
    document.getElementById('homeGoalTitle').style.color = leftColor;
    
    document.getElementById('awayGoalTitle').textContent = rightName;
    document.getElementById('awayGoalTitle').style.color = rightColor;
    
    // Update substitution team titles with team names and colors
    document.getElementById('homeSubTitle').textContent = leftName;
    document.getElementById('homeSubTitle').style.color = leftColor;
    
    document.getElementById('awaySubTitle').textContent = rightName;
    document.getElementById('awaySubTitle').style.color = rightColor;
}

function syncAllButtonColors() {
    const leftColor = leftTeamColor.value;
    const rightColor = rightTeamColor.value;
    document.getElementById('scoreBtnLeft').style.background = leftColor;
    document.getElementById('scoreBtnRight').style.background = rightColor;
    document.getElementById('lineupHomeBtn').style.background = leftColor;
    document.getElementById('lineupAwayBtn').style.background = rightColor;
}

// Gọi khi đổi màu hoặc đổi tên đội
leftTeamColor.addEventListener('input', syncAllButtonColors);
rightTeamColor.addEventListener('input', syncAllButtonColors);
leftTeamName.addEventListener('input', syncAllButtonColors);
rightTeamName.addEventListener('input', syncAllButtonColors);
window.addEventListener('DOMContentLoaded', syncAllButtonColors);

// Gọi khi load trang
window.addEventListener('DOMContentLoaded', updateDynamicButtonLabels);

// Auto-update team names to uppercase and sync all labels
leftTeamName.addEventListener('input', () => {
    const value = leftTeamName.value;
    if (value) {
        leftTeamName.value = value.toUpperCase();
    }
    updateDynamicButtonLabels();
});

rightTeamName.addEventListener('input', () => {
    const value = rightTeamName.value;
    if (value) {
        rightTeamName.value = value.toUpperCase();
    }
    updateDynamicButtonLabels();
});

// Instant Replay variables
let currentReplayUrl = '';





// Enhanced updateReplayUrl function
const updateReplayUrl = () => {
    const videoUrl = document.getElementById('replayVideoUrl').value.trim();
    
    if (!videoUrl) {
        showNotification('Vui lòng nhập URL video!', 'error');
        return;
    }
    
    currentReplayUrl = videoUrl;
    
    // Save to localStorage as fallback
    localStorage.setItem(`streamUrl_${tenantId}`, videoUrl);
    
    // Send to server
    fetch('/api/stream', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            url: videoUrl,
            tenantId: tenantId
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification(`URL video đã được cập nhật! (${data.type})`);
            console.log('URL processed:', {
                original: data.originalUrl,
                processed: data.processedUrl,
                type: data.type
            });
        } else {
            showNotification('Lỗi khi cập nhật URL: ' + data.message, 'error');
        }
    })
    .catch(error => {
        console.error('Error updating stream URL:', error);
        showNotification('Lỗi khi cập nhật URL (đã lưu vào cache)', 'warning');
    });
    
    console.log('Replay URL updated:', currentReplayUrl);
};





// Logout function
const logout = async () => {
    try {
        // Clear localStorage
        localStorage.removeItem('tenantId');
        localStorage.removeItem('username');
        
        // Call server logout (optional, for session cleanup)
        const response = await fetch('/api/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        // Redirect to login regardless of server response
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout error:', error);
        // Clear localStorage and redirect even if server call fails
        localStorage.removeItem('tenantId');
        localStorage.removeItem('username');
        window.location.href = '/login';
    }
};

// ===== INSTANT REPLAY SYSTEM =====
let instantReplayBuffer = null;
let bufferInterval = null;
let isBuffering = false;
let bufferStartTime = 0;
let bufferDuration = 10; // seconds

// Initialize instant replay system
const initInstantReplay = () => {
    console.log('Initializing instant replay system...');
    
    const bufferDurationSelect = document.getElementById('bufferDuration');
    if (bufferDurationSelect) {
        bufferDurationSelect.addEventListener('change', (e) => {
            bufferDuration = parseInt(e.target.value);
            updateBufferStatus();
        });
        console.log('Buffer duration selector initialized');
    } else {
        console.warn('Buffer duration selector not found');
    }
    
    updateBufferStatus();
    console.log('Instant replay system initialized');
};

// Start recording buffer
const startInstantReplay = async () => {
    try {
        // Check if we have a video URL
        if (!currentReplayUrl) {
            showNotification('Vui lòng cập nhật URL video trước! Bấm "Update URL" để cập nhật.', 'error');
            return;
        }

        // Check server connection first
        const isConnected = await checkServerConnection();
        if (!isConnected) {
            showNotification('Không thể kết nối đến server. Vui lòng kiểm tra kết nối mạng và thử lại.', 'error');
            return;
        }

        // Request server to start buffer with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch('/api/instant-replay/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                videoUrl: currentReplayUrl,
                bufferDuration: bufferDuration,
                tenantId: tenantId
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        if (data.success) {
            isBuffering = true;
            bufferStartTime = Date.now();
            
            // Update UI
            document.getElementById('startBufferBtn').disabled = true;
            document.getElementById('stopBufferBtn').disabled = false;
            document.getElementById('playReplayBtn').disabled = true;
            document.getElementById('hideReplayBtn').disabled = true;
            
            // Start status update interval
            bufferInterval = setInterval(updateBufferStatus, 1000);
            
            showNotification(`Đã bắt đầu buffer ${bufferDuration}s!`);
            
            // Emit to server
            socket.emit('instantReplayStart', {
                videoUrl: currentReplayUrl,
                bufferDuration: bufferDuration
            });
            
        } else {
            showNotification('Lỗi khi khởi động buffer: ' + data.message, 'error');
        }
        
    } catch (error) {
        console.error('Error starting instant replay:', error);
        
        // Provide more helpful error message based on error type
        if (error.name === 'AbortError') {
            showNotification('Kết nối timeout. Vui lòng kiểm tra mạng và thử lại.', 'error');
        } else if (error.message.includes('Unexpected token')) {
            showNotification('Lỗi kết nối server. Vui lòng thử lại sau.', 'error');
        } else if (error.message.includes('Failed to fetch')) {
            showNotification('Không thể kết nối đến server. Vui lòng kiểm tra kết nối mạng.', 'error');
        } else {
            showNotification('Lỗi khi khởi động instant replay: ' + error.message, 'error');
        }
    }
};

// Stop recording buffer
const stopInstantReplay = async () => {
    try {
        const response = await fetch('/api/instant-replay/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: tenantId })
        });

        const data = await response.json();
        
        if (data.success) {
            isBuffering = false;
            
            // Update UI
            document.getElementById('startBufferBtn').disabled = false;
            document.getElementById('stopBufferBtn').disabled = true;
            document.getElementById('playReplayBtn').disabled = false;
            document.getElementById('hideReplayBtn').disabled = false;
            
            // Stop status update interval
            if (bufferInterval) {
                clearInterval(bufferInterval);
                bufferInterval = null;
            }
            
            showNotification('Đã dừng buffer! Sẵn sàng phát replay.');
            
            // Emit to server
            socket.emit('instantReplayStop');
            
        } else {
            showNotification('Lỗi khi dừng buffer: ' + data.message, 'error');
        }
        
    } catch (error) {
        console.error('Error stopping instant replay:', error);
        showNotification('Lỗi khi dừng instant replay', 'error');
    }
};

// Play instant replay
const playInstantReplay = async () => {
    try {
        const response = await fetch('/api/instant-replay/play', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: tenantId })
        });

        const data = await response.json();
        
        if (data.success) {
            showNotification('Đang phát instant replay!');
            
            // Emit to server
            socket.emit('instantReplayPlay');
            
        } else {
            showNotification('Lỗi khi phát replay: ' + data.message, 'error');
        }
        
    } catch (error) {
        console.error('Error playing instant replay:', error);
        showNotification('Lỗi khi phát instant replay', 'error');
    }
};

// Hide instant replay
const hideInstantReplay = async () => {
    try {
        const response = await fetch('/api/instant-replay/hide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: tenantId })
        });

        const data = await response.json();
        
        if (data.success) {
            showNotification('Đã ẩn instant replay!');
            
            // Emit to server
            socket.emit('instantReplayHide');
            
        } else {
            showNotification('Lỗi khi ẩn replay: ' + data.message, 'error');
        }
        
    } catch (error) {
        console.error('Error hiding instant replay:', error);
        showNotification('Lỗi khi ẩn instant replay', 'error');
    }
};

// Update buffer status display
const updateBufferStatus = () => {
    const statusElement = document.getElementById('bufferStatus');
    const timeElement = document.getElementById('bufferTime');
    
    if (!statusElement || !timeElement) return;
    
    if (isBuffering) {
        const elapsed = Math.floor((Date.now() - bufferStartTime) / 1000);
        const remaining = Math.max(0, bufferDuration - elapsed);
        
        statusElement.textContent = `Buffer: Đang ghi (${elapsed}s)`;
        timeElement.textContent = `Thời gian: ${elapsed}s / ${bufferDuration}s`;
        
        // Auto-stop when buffer is full
        if (elapsed >= bufferDuration) {
            stopInstantReplay();
        }
    } else {
        statusElement.textContent = 'Buffer: Sẵn sàng phát';
        timeElement.textContent = `Thời gian: ${bufferDuration}s`;
    }
};

// Load current stream URL from server
const loadCurrentStreamUrl = async () => {
    try {
        console.log('Loading current stream URL for tenant:', tenantId);
        
        // Try the API endpoint first with timeout
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            const response = await fetch(`/api/stream?tenantId=${tenantId}`, {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            console.log('Response status:', response.status);
            console.log('Response headers:', response.headers);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error response:', errorText);
                throw new Error(`Server error: ${response.status} - ${errorText}`);
            }
            
            const data = await response.json();
            console.log('Response data:', data);
            
            if (data.url) {
                currentReplayUrl = data.url;
                const replayVideoUrlInput = document.getElementById('replayVideoUrl');
                if (replayVideoUrlInput) {
                    replayVideoUrlInput.value = data.url;
                }
                console.log('Loaded current stream URL from API:', currentReplayUrl);
                return;
            }
        } catch (apiError) {
            if (apiError.name === 'AbortError') {
                console.warn('API call timed out, trying fallback method');
            } else {
                console.warn('API call failed, trying fallback method:', apiError.message);
            }
        }
        
        // Fallback: Try to get from localStorage or use default
        const storedUrl = localStorage.getItem(`streamUrl_${tenantId}`);
        if (storedUrl) {
            currentReplayUrl = storedUrl;
            const replayVideoUrlInput = document.getElementById('replayVideoUrl');
            if (replayVideoUrlInput) {
                replayVideoUrlInput.value = storedUrl;
            }
            console.log('Loaded current stream URL from localStorage:', currentReplayUrl);
        } else {
            console.log('No current stream URL found, user will need to update manually');
        }
        
    } catch (error) {
        console.error('Error loading current stream URL:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack
        });
    }
};

// Check server connection
const checkServerConnection = async () => {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
        
        const response = await fetch('/api/stream?tenantId=' + tenantId, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        console.warn('Server connection check failed:', error.message);
        return false;
    }
};

// Initialize instant replay when page loads
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
        try {
            await loadCurrentStreamUrl();
        } catch (error) {
            console.warn('Could not load current stream URL, user will need to update manually');
        }
        initInstantReplay();
        
        // Force load players from lineup data
        updateLineupsUI();
        updatePlayerDropdowns();
    }, 1000);
});

// Penalty management
let penaltyData = {
    leftPenalties: [],
    rightPenalties: []
};

let penaltyVisible = false;

// Function to add penalty (goal or miss)
const addPenalty = (side, isGoal) => {
    // Check if game is over
    if (window.penaltyGameOver) {
        showNotification('Penalty shootout is over! Use Reset to start new game.', 'warning');
        return;
    }
    
    if (side === 'left') {
        penaltyData.leftPenalties.push(isGoal);
    } else {
        penaltyData.rightPenalties.push(isGoal);
    }
    
    updatePenaltyDisplay();
    updatePenaltyOverlay();
    
    // Show notification
    const teamName = side === 'left' ? 
        (document.getElementById('leftTeamName').value || 'LEFT TEAM') : 
        (document.getElementById('rightTeamName').value || 'RIGHT TEAM');
    const result = isGoal ? 'Goal' : 'Miss';
    showNotification(`${teamName} Penalty: ${result}!`);
};

// Function to reset penalties
const resetPenalties = () => {
    penaltyData = {
        leftPenalties: [],
        rightPenalties: []
    };
    
    // Reset game over state
    window.penaltyGameOver = false;
    
    // Enable penalty buttons
    const penaltyButtons = document.querySelectorAll('.penalty-btn');
    penaltyButtons.forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    });
    
    updatePenaltyDisplay();
    updatePenaltyOverlay();
    showNotification('Penalties reset successfully!');
};

// Function to update penalty display in admin panel
const updatePenaltyDisplay = () => {
    const leftCount = penaltyData.leftPenalties.filter(p => p).length;
    const leftTotal = penaltyData.leftPenalties.length;
    const rightCount = penaltyData.rightPenalties.filter(p => p).length;
    const rightTotal = penaltyData.rightPenalties.length;
    
    document.getElementById('leftPenaltyCount').textContent = leftCount;
    document.getElementById('leftPenaltyTotal').textContent = leftTotal;
    document.getElementById('rightPenaltyCount').textContent = rightCount;
    document.getElementById('rightPenaltyTotal').textContent = rightTotal;
};

// Function to update penalty overlay
const updatePenaltyOverlay = () => {
    const leftTeamName = document.getElementById('leftTeamName').value || 'LEFT TEAM';
    const rightTeamName = document.getElementById('rightTeamName').value || 'RIGHT TEAM';
    const leftTeamColor = document.getElementById('leftTeamColor').value || '#ff0000';
    const rightTeamColor = document.getElementById('rightTeamColor').value || '#0066cc';
    
    const overlayData = {
        leftTeam: leftTeamName,
        rightTeam: rightTeamName,
        leftPenalties: penaltyData.leftPenalties,
        rightPenalties: penaltyData.rightPenalties,
        leftTeamColor: leftTeamColor,
        rightTeamColor: rightTeamColor
    };
    
    if (penaltyVisible) {
        socket.emit('showPenalty', { tenantId: tenantId, data: overlayData });
    } else {
        socket.emit('updatePenalty', { tenantId: tenantId, data: overlayData });
    }
};

// Function to toggle penalty overlay visibility
const togglePenalty = () => {
    const toggleBtn = document.getElementById('penaltyToggleBtn');
    
    if (penaltyVisible) {
        // Hide penalty overlay
        toggleBtn.innerHTML = '👁️ Show';
        toggleBtn.classList.remove('btn-warning');
        toggleBtn.classList.add('btn-info');
        penaltyVisible = false;
        
        socket.emit('hidePenalty', { tenantId: tenantId });
        showNotification('Penalty overlay hidden!');
    } else {
        // Show penalty overlay
        toggleBtn.innerHTML = '👁️ Hide';
        toggleBtn.classList.remove('btn-info');
        toggleBtn.classList.add('btn-warning');
        penaltyVisible = true;
        
        updatePenaltyOverlay();
        showNotification('Penalty overlay shown!');
    }
};

// Function to update penalty titles
const updatePenaltyTitles = () => {
    const leftTeamName = document.getElementById('leftTeamName').value || 'HOME';
    const rightTeamName = document.getElementById('rightTeamName').value || 'AWAY';
    const leftTeamColor = document.getElementById('leftTeamColor').value || '#ff0000';
    const rightTeamColor = document.getElementById('rightTeamColor').value || '#0066cc';

    const homePenaltyTitle = document.getElementById('homePenaltyTitle');
    const awayPenaltyTitle = document.getElementById('awayPenaltyTitle');
    
    if (homePenaltyTitle) {
        homePenaltyTitle.textContent = leftTeamName;
        homePenaltyTitle.style.color = leftTeamColor;
    }
    if (awayPenaltyTitle) {
        awayPenaltyTitle.textContent = rightTeamName;
        awayPenaltyTitle.style.color = rightTeamColor;
    }
    
    // Update penalty overlay if visible
    if (penaltyVisible) {
        updatePenaltyOverlay();
    }
};

// Add penalty titles to the update function
const originalUpdateAllTeamTitles = updateAllTeamTitles;
updateAllTeamTitles = function() {
    originalUpdateAllTeamTitles();
    updatePenaltyTitles();
    
    // Update lineup labels
    const leftTeamName = document.getElementById('leftTeamName').value || 'Left Team';
    const rightTeamName = document.getElementById('rightTeamName').value || 'Right Team';
    const leftTeamColor = document.getElementById('leftTeamColor').value || '#ff0000';
    const rightTeamColor = document.getElementById('rightTeamColor').value || '#0066cc';

    // Update left team label
    const leftTeamLabel = document.getElementById('leftTeamLabel');
    if (leftTeamLabel) {
        leftTeamLabel.textContent = leftTeamName + ':';
        leftTeamLabel.style.color = leftTeamColor;
    }

    // Update right team label
    const rightTeamLabel = document.getElementById('rightTeamLabel');
    if (rightTeamLabel) {
        rightTeamLabel.textContent = rightTeamName + ':';
        rightTeamLabel.style.color = rightTeamColor;
    }

    // Update lineup button names
    const lineupHomeBtnName = document.getElementById('lineupHomeBtnName');
    const lineupAwayBtnName = document.getElementById('lineupAwayBtnName');
    
    if (lineupHomeBtnName) {
        lineupHomeBtnName.textContent = leftTeamName;
    }
    if (lineupAwayBtnName) {
        lineupAwayBtnName.textContent = rightTeamName;
    }
    
    // Update penalty overlay if visible
    if (penaltyVisible) {
        updatePenaltyOverlay();
    }
};

// Initialize penalty display
updatePenaltyDisplay();

// Listen for penalty game over event
socket.on('penaltyGameOver', (data) => {
    window.penaltyGameOver = true;
    const winningTeam = data.winner === 'left' ? data.leftTeam : data.rightTeam;
    showNotification(`${winningTeam} wins the penalty shootout!`, 'success');
    
    // Disable penalty buttons
    const penaltyButtons = document.querySelectorAll('.penalty-btn');
    penaltyButtons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    });
});

// Initialize penalty titles
updatePenaltyTitles();
