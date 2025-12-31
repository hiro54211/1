import React, { useRef, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// --- Audio System (Web Audio API) ---
class SoundSynth {
  ctx: AudioContext | null = null;
  masterGain: GainNode | null = null;

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3; // Master volume
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playShoot() {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);
    
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  playExplosion(isLarge = false) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * (isLarge ? 0.5 : 0.2);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(isLarge ? 0.8 : 0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + (isLarge ? 0.4 : 0.15));
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(t);
  }

  playDash() {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.linearRampToValueAtTime(600, t + 0.2);
    
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.2);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  playLevelUp() {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.setValueAtTime(554, t + 0.1);
    osc.frequency.setValueAtTime(659, t + 0.2);
    osc.frequency.setValueAtTime(880, t + 0.3);
    
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.6);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.6);
  }
}
const audio = new SoundSynth();

// --- Types ---

type GameState = "MENU" | "PLAYING" | "LEVEL_UP" | "GAME_OVER";

interface Entity {
  id: number;
  x: number;
  y: number;
  radius: number;
  markedForDeletion: boolean;
}

interface Player extends Entity {
  hp: number;
  maxHp: number;
  speed: number;
  xp: number;
  level: number;
  nextLevelXp: number;
  dashCooldown: number;
  maxDashCooldown: number;
  dashDuration: number;
  trail: {x: number, y: number, alpha: number}[];
  weapons: {
    missile: { level: number; cooldown: number; maxCooldown: number; damage: number };
    orbit: { level: number; count: number; radius: number; speed: number; angle: number; damage: number };
    aura: { level: number; radius: number; tickRate: number; tickTimer: number; damage: number };
  };
}

interface Enemy extends Entity {
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  type: "minion" | "witch" | "golem" | "bat";
  color: string;
}

interface Bullet extends Entity {
  vx: number;
  vy: number;
  damage: number;
  duration: number;
  penetration: number;
  color: string;
}

interface Particle extends Entity {
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

interface Gem extends Entity {
  value: number;
  vx: number;
  vy: number;
  color: string;
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  vy: number;
}

const UPGRADES = [
  { id: "missile", name: "Star Missiles", description: "Fires tracking missiles more frequently." },
  { id: "orbit", name: "Spirit Satellites", description: "Orbs that circle you and block enemies." },
  { id: "aura", name: "Purification Field", description: "Damages all enemies near you constantly." },
  { id: "speed", name: "Swift Step", description: "Move faster. Dash recharges faster." },
  { id: "heal", name: "Angelic Grace", description: "Heal 30% HP and increase Max HP." },
];

// --- Main App ---

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>("MENU");
  const [score, setScore] = useState(0);
  const [playerUI, setPlayerUI] = useState({ hp: 100, maxHp: 100, xp: 0, nextLevelXp: 100, level: 1 });
  const [availableUpgrades, setAvailableUpgrades] = useState<typeof UPGRADES>([]);

  const gameRef = useRef({
    player: null as Player | null,
    keys: {} as Record<string, boolean>,
    enemies: [] as Enemy[],
    bullets: [] as Bullet[],
    particles: [] as Particle[],
    gems: [] as Gem[],
    texts: [] as FloatingText[],
    camera: { x: 0, y: 0 },
    gameTime: 0,
    score: 0,
    spawnTimer: 0,
  });

  const initGame = () => {
    audio.init();
    audio.playLevelUp();
    gameRef.current = {
      player: {
        id: 0, x: 0, y: 0, radius: 12, markedForDeletion: false,
        hp: 100, maxHp: 100, speed: 3.5, xp: 0, level: 1, nextLevelXp: 50,
        dashCooldown: 0, maxDashCooldown: 90, dashDuration: 0,
        trail: [],
        weapons: {
          missile: { level: 1, cooldown: 0, maxCooldown: 45, damage: 20 },
          orbit: { level: 0, count: 0, radius: 70, speed: 0.05, angle: 0, damage: 10 },
          aura: { level: 0, radius: 100, tickRate: 20, tickTimer: 0, damage: 3 },
        }
      },
      keys: {},
      enemies: [],
      bullets: [],
      particles: [],
      gems: [],
      texts: [],
      camera: { x: 0, y: 0 },
      gameTime: 0,
      score: 0,
      spawnTimer: 0,
    };
    setScore(0);
    setPlayerUI({ hp: 100, maxHp: 100, xp: 0, nextLevelXp: 50, level: 1 });
  };

  const spawnEnemy = (player: Player) => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 400 + Math.random() * 300;
    const x = player.x + Math.cos(angle) * distance;
    const y = player.y + Math.sin(angle) * distance;
    
    // Game progression logic
    const difficulty = gameRef.current.gameTime / 600; // Increase every 10s
    const rand = Math.random();

    let type: Enemy['type'] = "minion";
    let hp = 15 + (difficulty * 5);
    let speed = 2 + Math.random();
    let radius = 10;
    let color = "#555";
    let damage = 5;

    if (difficulty > 1 && rand > 0.8) {
      type = "bat";
      color = "#4b0082"; // Indigo
      speed = 3.5;
      hp = 10 + (difficulty * 2);
      radius = 8;
    } else if (difficulty > 3 && rand > 0.9) {
      type = "witch";
      color = "#9932cc"; // Dark Orchid
      speed = 1.5;
      hp = 40 + (difficulty * 10);
      radius = 15;
      damage = 15;
    } else if (difficulty > 5 && rand > 0.98) {
      type = "golem";
      color = "#8b4513"; // Saddle Brown
      speed = 0.8;
      hp = 200 + (difficulty * 50);
      radius = 30;
      damage = 25;
    }

    gameRef.current.enemies.push({
      id: Math.random(), x, y, radius, type, hp, maxHp: hp, speed, damage, color, markedForDeletion: false
    });
  };

  const spawnBullet = (x: number, y: number, target: {x: number, y: number}, dmg: number) => {
    const angle = Math.atan2(target.y - y, target.x - x);
    gameRef.current.bullets.push({
      id: Math.random(), x, y, radius: 4, vx: Math.cos(angle) * 12, vy: Math.sin(angle) * 12,
      damage: dmg, duration: 80, penetration: 1, color: "#ffff00", markedForDeletion: false
    });
    audio.playShoot();
  };

  const spawnText = (x: number, y: number, text: string, color: string) => {
    gameRef.current.texts.push({
      id: Math.random(), x, y: y - 10, text, color, life: 30, vy: -1.5
    });
  };

  const createParticles = (x: number, y: number, color: string, count: number) => {
    for(let i=0; i<count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4;
      gameRef.current.particles.push({
        id: Math.random(), x, y, radius: Math.random() * 3 + 1,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 20 + Math.random() * 10, maxLife: 30, color, markedForDeletion: false
      });
    }
  };

  // --- Update Loop ---

  const update = () => {
    if (gameState !== "PLAYING") return;
    const game = gameRef.current;
    const { player, keys } = game;
    if (!player) return;

    game.gameTime++;

    // 1. Controls & Movement
    let dx = 0, dy = 0;
    if (keys["w"] || keys["ArrowUp"]) dy = -1;
    if (keys["s"] || keys["ArrowDown"]) dy = 1;
    if (keys["a"] || keys["ArrowLeft"]) dx = -1;
    if (keys["d"] || keys["ArrowRight"]) dx = 1;

    // Dash Logic (Spacebar)
    const isDashKey = keys[" "] || keys["Shift"];
    if (player.dashCooldown > 0) player.dashCooldown--;
    
    if (player.dashDuration > 0) {
      // Dashing state
      player.dashDuration--;
      const dashSpeed = 12; // High speed
      // Keep moving in last direction if no input, else input dir
      if (dx === 0 && dy === 0) {
        // Only if we stored momentum, but for simplicity let's require input or drift
      }
      if (dx !== 0 || dy !== 0) {
         const len = Math.hypot(dx, dy);
         player.x += (dx/len) * dashSpeed;
         player.y += (dy/len) * dashSpeed;
      }
      
      // Trail effect
      player.trail.push({ x: player.x, y: player.y, alpha: 1.0 });
      
    } else {
      // Normal state
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        player.x += (dx/len) * player.speed;
        player.y += (dy/len) * player.speed;
      }

      if (isDashKey && player.dashCooldown <= 0 && (dx !== 0 || dy !== 0)) {
        player.dashDuration = 15; // 0.25s dash
        player.dashCooldown = player.maxDashCooldown;
        audio.playDash();
      }
    }

    // Trail Decay
    player.trail.forEach(t => t.alpha -= 0.1);
    player.trail = player.trail.filter(t => t.alpha > 0);

    // Camera
    game.camera.x = player.x - window.innerWidth / 2;
    game.camera.y = player.y - window.innerHeight / 2;

    // 2. Weapon Systems
    
    // Missile
    if (player.weapons.missile.cooldown > 0) player.weapons.missile.cooldown--;
    else if (game.enemies.length > 0) {
      // Find nearest
      let nearest = null;
      let minDst = 500;
      for (const e of game.enemies) {
        const dst = Math.hypot(e.x - player.x, e.y - player.y);
        if (dst < minDst) { minDst = dst; nearest = e; }
      }
      if (nearest) {
        spawnBullet(player.x, player.y, nearest, player.weapons.missile.damage);
        player.weapons.missile.cooldown = player.weapons.missile.maxCooldown;
      }
    }

    // Orbit
    if (player.weapons.orbit.level > 0) {
      player.weapons.orbit.angle += player.weapons.orbit.speed;
    }

    // Aura
    if (player.weapons.aura.level > 0) {
      player.weapons.aura.tickTimer++;
      if (player.weapons.aura.tickTimer >= player.weapons.aura.tickRate) {
        player.weapons.aura.tickTimer = 0;
        game.enemies.forEach(e => {
          if (Math.hypot(e.x - player.x, e.y - player.y) < player.weapons.aura.radius) {
            e.hp -= player.weapons.aura.damage;
            spawnText(e.x, e.y, `${player.weapons.aura.damage}`, "#ffeb3b");
          }
        });
      }
    }

    // 3. Enemy Logic & Spawning
    game.spawnTimer++;
    // Spawn formula: faster as time goes on, cap at some point
    const spawnInterval = Math.max(5, 40 - Math.floor(game.gameTime / 300));
    if (game.spawnTimer > spawnInterval) {
      spawnEnemy(player);
      game.spawnTimer = 0;
    }

    game.enemies.forEach(e => {
      // Move towards player
      const angle = Math.atan2(player.y - e.y, player.x - e.x);
      e.x += Math.cos(angle) * e.speed;
      e.y += Math.sin(angle) * e.speed;

      // Soft collision (boids separation)
      // Optimized: Only check a few nearby or just random pushes to save perf on heavy waves
      if (game.gameTime % 5 === 0) {
          game.enemies.forEach(other => {
              if (e === other) return;
              const dx = e.x - other.x;
              const dy = e.y - other.y;
              if (Math.abs(dx) < 20 && Math.abs(dy) < 20) { // Fast box check first
                 const dist = Math.hypot(dx, dy);
                 if (dist < e.radius + other.radius) {
                     e.x += dx * 0.1;
                     e.y += dy * 0.1;
                 }
              }
          });
      }

      // Player Collision
      const distToPlayer = Math.hypot(player.x - e.x, player.y - e.y);
      if (distToPlayer < player.radius + e.radius) {
        if (player.dashDuration > 0) {
          // Dash Kill ("Swimming Dragon" Impact)
          e.hp -= 999;
          spawnText(e.x, e.y, "CRIT!", "#ff00ff");
          createParticles(e.x, e.y, "#ff00ff", 5);
          audio.playExplosion(false);
        } else {
          // Player Hurt
          player.hp -= 1; // Simplified damage
          // Bounce back slightly
          player.x += Math.cos(angle) * 5;
          player.y += Math.sin(angle) * 5;
        }
      }

      // Orbit Collision
      if (player.weapons.orbit.level > 0) {
        const { count, radius, angle: orbAngle, damage } = player.weapons.orbit;
        for(let i=0; i<count; i++) {
          const theta = orbAngle + (i * (Math.PI*2/count));
          const ox = player.x + Math.cos(theta) * radius;
          const oy = player.y + Math.sin(theta) * radius;
          if (Math.hypot(ox - e.x, oy - e.y) < 15 + e.radius) {
            e.hp -= damage;
            createParticles(e.x, e.y, "#00ffff", 1);
          }
        }
      }

      if (e.hp <= 0) {
        e.markedForDeletion = true;
        game.score += (e.type === 'minion' ? 10 : 50);
        game.gems.push({
          id: Math.random(), x: e.x, y: e.y, radius: 4, 
          value: e.type === 'golem' ? 50 : 5, 
          color: e.type === 'golem' ? "#ff0000" : "#00ffcc",
          markedForDeletion: false, vx: 0, vy: 0
        });
        audio.playExplosion(e.type !== 'minion');
        createParticles(e.x, e.y, e.color, 5);
      }
    });

    // 4. Bullets
    game.bullets.forEach(b => {
      b.x += b.vx;
      b.y += b.vy;
      b.duration--;
      if (b.duration <= 0) b.markedForDeletion = true;
      
      // Simple Hitbox
      for (const e of game.enemies) {
        if (!e.markedForDeletion && Math.hypot(b.x - e.x, b.y - e.y) < b.radius + e.radius) {
          e.hp -= b.damage;
          spawnText(e.x, e.y, `${Math.floor(b.damage)}`, "#fff");
          b.penetration--;
          createParticles(b.x, b.y, "#ffff00", 2);
          if (b.penetration <= 0) {
            b.markedForDeletion = true;
            break;
          }
        }
      }
    });

    // 5. Gems
    game.gems.forEach(g => {
      const dist = Math.hypot(player.x - g.x, player.y - g.y);
      const magnetRange = 120 + (player.level * 5);
      if (dist < magnetRange) {
        g.x += (player.x - g.x) * 0.15;
        g.y += (player.y - g.y) * 0.15;
      }
      if (dist < player.radius + g.radius) {
        g.markedForDeletion = true;
        player.xp += g.value;
        if (player.xp >= player.nextLevelXp) {
          player.level++;
          player.xp -= player.nextLevelXp;
          player.nextLevelXp = Math.floor(player.nextLevelXp * 1.3);
          setGameState("LEVEL_UP");
          audio.playLevelUp();
          generateUpgrades();
        }
      }
    });

    // 6. Particles & Text
    game.particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      p.vx *= 0.95;
      p.vy *= 0.95;
    });
    
    game.texts.forEach(t => {
      t.y += t.vy;
      t.life--;
    });

    // Cleanup
    game.enemies = game.enemies.filter(e => !e.markedForDeletion);
    game.bullets = game.bullets.filter(b => !b.markedForDeletion);
    game.gems = game.gems.filter(g => !g.markedForDeletion);
    game.particles = game.particles.filter(p => p.life > 0);
    game.texts = game.texts.filter(t => t.life > 0);

    // Sync UI (throttled slightly by react state nature)
    if (game.gameTime % 5 === 0) {
        setScore(game.score);
        setPlayerUI({
            hp: player.hp, maxHp: player.maxHp,
            xp: player.xp, nextLevelXp: player.nextLevelXp,
            level: player.level
        });
    }

    if (player.hp <= 0) setGameState("GAME_OVER");
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const game = gameRef.current;
    const { player, enemies, bullets, gems, particles, texts, camera } = game;
    
    // BG
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Grid
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    const gs = 100; // grid size
    const startX = Math.floor(camera.x / gs) * gs;
    const startY = Math.floor(camera.y / gs) * gs;
    ctx.beginPath();
    for (let x = startX; x < startX + window.innerWidth + gs; x += gs) {
      ctx.moveTo(x, startY); ctx.lineTo(x, startY + window.innerHeight + gs);
    }
    for (let y = startY; y < startY + window.innerHeight + gs; y += gs) {
      ctx.moveTo(startX, y); ctx.lineTo(startX + window.innerWidth + gs, y);
    }
    ctx.stroke();

    // Gems
    gems.forEach(g => {
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI*2);
      ctx.fill();
    });

    // Enemies
    enemies.forEach(e => {
      ctx.fillStyle = e.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = e.color;
      ctx.beginPath();
      if (e.type === 'minion') {
        // Triangle pointing at player
        // Simple circle for performance with mass enemies
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI*2);
      } else if (e.type === 'bat') {
        ctx.moveTo(e.x, e.y - e.radius);
        ctx.lineTo(e.x + e.radius, e.y + e.radius);
        ctx.lineTo(e.x - e.radius, e.y + e.radius);
      } else {
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI*2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Player
    if (player) {
      // Trail (The Swimming Dragon)
      if (player.trail.length > 0) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = player.radius * 2;
        ctx.beginPath();
        // Draw connected lines with fading alpha
        for (let i = 0; i < player.trail.length - 1; i++) {
            const p1 = player.trail[i];
            const p2 = player.trail[i+1];
            ctx.globalAlpha = p1.alpha * 0.6;
            ctx.strokeStyle = `rgba(255, 105, 180, ${p1.alpha})`; // Pink Trail
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1.0;
      }

      // Aura
      if (player.weapons.aura.level > 0) {
          ctx.beginPath();
          ctx.arc(player.x, player.y, player.weapons.aura.radius, 0, Math.PI*2);
          ctx.fillStyle = 'rgba(255, 255, 0, 0.05)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 0, 0.2)';
          ctx.stroke();
      }

      // Orbits
      if (player.weapons.orbit.level > 0) {
          const { count, radius, angle } = player.weapons.orbit;
          ctx.fillStyle = "#00ffff";
          ctx.shadowBlur = 10;
          ctx.shadowColor = "#00ffff";
          for(let i=0; i<count; i++) {
              const th = angle + (i * Math.PI*2/count);
              ctx.beginPath();
              ctx.arc(player.x + Math.cos(th)*radius, player.y + Math.sin(th)*radius, 6, 0, Math.PI*2);
              ctx.fill();
          }
          ctx.shadowBlur = 0;
      }

      // Character
      ctx.fillStyle = "#ff69b4";
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius, 0, Math.PI*2);
      ctx.fill();
      // Glow
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#ff69b4";
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Bullets
    ctx.fillStyle = "#ffff00";
    bullets.forEach(b => {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI*2);
      ctx.fill();
    });

    // Particles
    particles.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    });

    // Floating Text
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    texts.forEach(t => {
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    });

    ctx.restore();
  };

  const generateUpgrades = () => {
    const shuffled = [...UPGRADES].sort(() => 0.5 - Math.random());
    setAvailableUpgrades(shuffled.slice(0, 3));
  };

  const applyUpgrade = (id: string) => {
    const p = gameRef.current.player;
    if (!p) return;
    if (id === "missile") {
        p.weapons.missile.level++;
        p.weapons.missile.damage += 10;
        p.weapons.missile.maxCooldown *= 0.85;
    }
    if (id === "orbit") {
        p.weapons.orbit.level++;
        p.weapons.orbit.count++;
        p.weapons.orbit.damage += 5;
    }
    if (id === "aura") {
        p.weapons.aura.level++;
        p.weapons.aura.radius += 15;
        p.weapons.aura.damage += 2;
    }
    if (id === "speed") {
        p.speed += 0.5;
        p.maxDashCooldown = Math.max(30, p.maxDashCooldown - 10);
    }
    if (id === "heal") {
        p.maxHp += 20;
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
    }
    audio.playLevelUp(); // Confirmation sound
    setGameState("PLAYING");
  };

  // --- Effects ---

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false }); // Optimize
    if (!ctx) return;

    const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);
    resize();

    let animationId: number;
    const loop = () => {
      update();
      draw(ctx);
      animationId = requestAnimationFrame(loop);
    };
    animationId = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, [gameState]); // Re-bind if game state changes? No, update checks state.

  useEffect(() => {
    const handleKey = (e: KeyboardEvent, isDown: boolean) => {
      if (gameRef.current) gameRef.current.keys[e.key] = isDown;
    };
    const down = (e: KeyboardEvent) => handleKey(e, true);
    const up = (e: KeyboardEvent) => handleKey(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // --- UI ---

  const percent = (cur: number, max: number) => Math.min(100, Math.max(0, (cur/max)*100));

  return (
    <>
      <canvas ref={canvasRef} />
      
      {/* HUD */}
      {(gameState === "PLAYING" || gameState === "LEVEL_UP") && (
        <>
          <div className="hud">
            <div className="hud-row">
                <span style={{fontWeight:'bold', color: '#ff69b4'}}>HP</span>
                <div className="bar-frame">
                    <div className="bar-fill hp-fill" style={{width: `${percent(playerUI.hp, playerUI.maxHp)}%`}}></div>
                </div>
            </div>
            <div className="hud-row">
                <span style={{fontWeight:'bold', color: '#00ffff'}}>XP</span>
                <div className="bar-frame">
                    <div className="bar-fill xp-fill" style={{width: `${percent(playerUI.xp, playerUI.nextLevelXp)}%`}}></div>
                </div>
                <span style={{fontWeight:'bold'}}>Lv.{playerUI.level}</span>
            </div>
          </div>
          <div className="score-display">{score}</div>
        </>
      )}

      {/* Menu Overlay */}
      {gameState === "MENU" && (
        <div className="overlay">
          <div className="title">NIKAIDO</div>
          <div className="subtitle">Witch Prison Rampage</div>
          <button className="start-btn" onClick={() => { initGame(); setGameState("PLAYING"); }}>
            Start Game
          </button>
          <div className="controls-hint">
             <span><span className="key">WASD</span> Move</span>
             <span><span className="key">SPACE</span> Swimming Dragon (Dash)</span>
          </div>
        </div>
      )}

      {/* Level Up Overlay */}
      {gameState === "LEVEL_UP" && (
        <div className="overlay">
           <h2 style={{color: '#ffd700', fontSize: '32px', marginBottom: '30px'}}>CHOOSE UPGRADE</h2>
           <div className="card-container">
              {availableUpgrades.map(u => (
                  <div key={u.id} className="card" onClick={() => applyUpgrade(u.id)}>
                      <h3>{u.name}</h3>
                      <p>{u.description}</p>
                  </div>
              ))}
           </div>
        </div>
      )}

      {/* Game Over Overlay */}
      {gameState === "GAME_OVER" && (
        <div className="overlay">
          <h1 style={{color: '#ff3333', fontSize: '48px', marginBottom: '10px'}}>GAME OVER</h1>
          <p style={{fontSize: '24px', marginBottom: '30px'}}>Final Score: {score}</p>
          <button className="start-btn" onClick={() => { initGame(); setGameState("PLAYING"); }}>
            Try Again
          </button>
        </div>
      )}
    </>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
