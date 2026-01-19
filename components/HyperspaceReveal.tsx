/**
 * @file HyperspaceReveal.tsx
 * @description Animation de saut en hyperespace style Star Wars / Faucon Millennium
 * @domain UX - Spectacle Entry Animation
 * 
 * PHASES D'ANIMATION (1.5s total):
 * 1. IDLE: Champ d'étoiles lent avec scintillement
 * 2. WARP: Accélération exponentielle + traînées lumineuses
 * 3. FLASH: Éclair blanc intense au pic de vitesse
 * 4. REVEAL: Fade out canvas + apparition du contenu
 * 
 * TECHNIQUE:
 * - Canvas 2D natif (requestAnimationFrame)
 * - Projection 3D → 2D pour effet de profondeur
 * - 400 particules avec glow dynamique
 * - Performance optimisée 60 FPS
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // Étoiles
    STAR_COUNT: 400,
    STAR_COLORS: ['#FFFFFF', '#00D9FF', '#00FFFF', '#E0FFFF'],
    STAR_MIN_SIZE: 1,
    STAR_MAX_SIZE: 3,
    
    // Espace 3D (profondeur)
    DEPTH_MIN: 1,
    DEPTH_MAX: 1000,
    SPREAD_X: 2000,
    SPREAD_Y: 2000,
    
    // Vitesses
    IDLE_SPEED: 0.5,
    WARP_SPEED_MAX: 80,
    WARP_ACCELERATION: 1.15, // Facteur exponentiel
    
    // Timings (ms)
    WARP_DURATION: 800,
    FLASH_DURATION: 200,
    REVEAL_DURATION: 500,
    
    // Visuels
    TRAIL_LENGTH_MULTIPLIER: 0.15,
    GLOW_INTENSITY: 1.5,
    FLASH_OPACITY_PEAK: 1,
};

// ============================================
// TYPES
// ============================================

interface Star {
    x: number;      // Position 3D
    y: number;
    z: number;
    prevX: number;  // Position précédente pour traînée
    prevY: number;
    size: number;
    color: string;
    twinkleOffset: number;
    twinkleSpeed: number;
}

type AnimationPhase = 'idle' | 'warp' | 'flash' | 'reveal' | 'complete';

interface HyperspaceRevealProps {
    /** Déclenche l'animation warp */
    isActive: boolean;
    /** Callback quand l'animation est terminée */
    onComplete?: () => void;
    /** Contenu à révéler */
    children: React.ReactNode;
    /** Classe CSS additionnelle */
    className?: string;
    /** Durée personnalisée (ms) */
    duration?: number;
}

// ============================================
// UTILITAIRES MATHÉMATIQUES
// ============================================

/** Nombre aléatoire dans une plage */
const random = (min: number, max: number): number => 
    Math.random() * (max - min) + min;

/** Interpolation linéaire */
const lerp = (a: number, b: number, t: number): number => 
    a + (b - a) * t;

/** Easing exponentiel out */
const easeOutExpo = (t: number): number => 
    t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

/** Easing cubic in */
const easeInCubic = (t: number): number => 
    t * t * t;

/** Projection 3D → 2D (perspective) */
const project3Dto2D = (
    x3d: number, 
    y3d: number, 
    z: number, 
    centerX: number, 
    centerY: number,
    focalLength: number = 300
): { x: number; y: number; scale: number } => {
    const scale = focalLength / (focalLength + z);
    return {
        x: centerX + x3d * scale,
        y: centerY + y3d * scale,
        scale
    };
};

// ============================================
// COMPOSANT PRINCIPAL
// ============================================

export const HyperspaceReveal: React.FC<HyperspaceRevealProps> = ({
    isActive,
    onComplete,
    children,
    className = '',
    duration = CONFIG.WARP_DURATION + CONFIG.FLASH_DURATION + CONFIG.REVEAL_DURATION
}) => {
    // Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animationRef = useRef<number>(0);
    const starsRef = useRef<Star[]>([]);
    
    // State
    const [phase, setPhase] = useState<AnimationPhase>('idle');
    const [canvasOpacity, setCanvasOpacity] = useState(1);
    const [flashOpacity, setFlashOpacity] = useState(0);
    const [contentVisible, setContentVisible] = useState(false);
    const [isCanvasActive, setIsCanvasActive] = useState(true);
    
    // Animation state refs (pour éviter re-renders)
    const phaseRef = useRef<AnimationPhase>('idle');
    const speedRef = useRef(CONFIG.IDLE_SPEED);
    const warpStartTimeRef = useRef(0);
    const lastTimeRef = useRef(0);
    
    // ============================================
    // INITIALISATION DES ÉTOILES
    // ============================================
    
    const initializeStars = useCallback((width: number, height: number) => {
        const stars: Star[] = [];
        
        for (let i = 0; i < CONFIG.STAR_COUNT; i++) {
            stars.push({
                x: random(-CONFIG.SPREAD_X / 2, CONFIG.SPREAD_X / 2),
                y: random(-CONFIG.SPREAD_Y / 2, CONFIG.SPREAD_Y / 2),
                z: random(CONFIG.DEPTH_MIN, CONFIG.DEPTH_MAX),
                prevX: 0,
                prevY: 0,
                size: random(CONFIG.STAR_MIN_SIZE, CONFIG.STAR_MAX_SIZE),
                color: CONFIG.STAR_COLORS[Math.floor(random(0, CONFIG.STAR_COLORS.length))],
                twinkleOffset: random(0, Math.PI * 2),
                twinkleSpeed: random(2, 5)
            });
        }
        
        starsRef.current = stars;
    }, []);
    
    // ============================================
    // BOUCLE DE RENDU
    // ============================================
    
    const render = useCallback((timestamp: number) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        
        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        
        // Delta time pour animation fluide
        const deltaTime = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 16.67 : 1;
        lastTimeRef.current = timestamp;
        
        // Clear avec fade (traînées)
        const currentPhase = phaseRef.current;
        if (currentPhase === 'warp') {
            ctx.fillStyle = 'rgba(0, 5, 15, 0.15)';
        } else {
            ctx.fillStyle = 'rgba(0, 5, 15, 0.3)';
        }
        ctx.fillRect(0, 0, width, height);
        
        // Calcul de la vitesse selon la phase
        let currentSpeed = speedRef.current;
        
        if (currentPhase === 'warp') {
            const elapsed = timestamp - warpStartTimeRef.current;
            const progress = Math.min(elapsed / CONFIG.WARP_DURATION, 1);
            
            // Accélération exponentielle
            currentSpeed = CONFIG.IDLE_SPEED + 
                (CONFIG.WARP_SPEED_MAX - CONFIG.IDLE_SPEED) * easeInCubic(progress);
            
            speedRef.current = currentSpeed;
            
            // Transition vers flash
            if (progress >= 1) {
                phaseRef.current = 'flash';
                setPhase('flash');
                setFlashOpacity(CONFIG.FLASH_OPACITY_PEAK);
                
                // Timer pour reveal
                setTimeout(() => {
                    phaseRef.current = 'reveal';
                    setPhase('reveal');
                    setFlashOpacity(0);
                    setCanvasOpacity(0);
                    setContentVisible(true);
                    
                    setTimeout(() => {
                        phaseRef.current = 'complete';
                        setPhase('complete');
                        setIsCanvasActive(false);
                        onComplete?.();
                    }, CONFIG.REVEAL_DURATION);
                }, CONFIG.FLASH_DURATION);
            }
        }
        
        // Mise à jour et rendu des étoiles
        const stars = starsRef.current;
        
        for (let i = 0; i < stars.length; i++) {
            const star = stars[i];
            
            // Sauvegarder position précédente pour traînée
            const prevProj = project3Dto2D(star.x, star.y, star.z, centerX, centerY);
            star.prevX = prevProj.x;
            star.prevY = prevProj.y;
            
            // Déplacer l'étoile vers l'observateur
            star.z -= currentSpeed * deltaTime;
            
            // Réinitialiser si trop proche
            if (star.z < CONFIG.DEPTH_MIN) {
                star.z = CONFIG.DEPTH_MAX;
                star.x = random(-CONFIG.SPREAD_X / 2, CONFIG.SPREAD_X / 2);
                star.y = random(-CONFIG.SPREAD_Y / 2, CONFIG.SPREAD_Y / 2);
            }
            
            // Projection 3D → 2D
            const proj = project3Dto2D(star.x, star.y, star.z, centerX, centerY);
            
            // Skip si hors écran
            if (proj.x < -50 || proj.x > width + 50 || proj.y < -50 || proj.y > height + 50) {
                continue;
            }
            
            // Calcul de la taille et luminosité
            const depthFactor = 1 - (star.z / CONFIG.DEPTH_MAX);
            const size = star.size * proj.scale * (1 + depthFactor);
            
            // Scintillement (idle uniquement)
            let brightness = depthFactor;
            if (currentPhase === 'idle') {
                const twinkle = Math.sin(timestamp * 0.001 * star.twinkleSpeed + star.twinkleOffset);
                brightness *= 0.7 + 0.3 * twinkle;
            } else if (currentPhase === 'warp') {
                brightness = Math.min(1, brightness * CONFIG.GLOW_INTENSITY);
            }
            
            // Extraction couleur avec alpha
            const alpha = Math.min(1, brightness);
            
            // RENDU
            ctx.save();
            
            if (currentPhase === 'warp' && currentSpeed > 5) {
                // Mode traînée (lignes radiales)
                const trailLength = currentSpeed * CONFIG.TRAIL_LENGTH_MULTIPLIER * proj.scale;
                
                // Gradient pour la traînée
                const gradient = ctx.createLinearGradient(
                    star.prevX, star.prevY,
                    proj.x, proj.y
                );
                gradient.addColorStop(0, 'transparent');
                gradient.addColorStop(0.5, star.color);
                gradient.addColorStop(1, '#FFFFFF');
                
                ctx.strokeStyle = gradient;
                ctx.lineWidth = Math.max(1, size * 0.8);
                ctx.lineCap = 'round';
                ctx.globalAlpha = alpha;
                
                // Glow
                ctx.shadowColor = star.color;
                ctx.shadowBlur = 15 * brightness;
                
                ctx.beginPath();
                ctx.moveTo(star.prevX, star.prevY);
                ctx.lineTo(proj.x, proj.y);
                ctx.stroke();
                
            } else {
                // Mode point (idle)
                ctx.globalAlpha = alpha;
                
                // Glow externe
                if (brightness > 0.3) {
                    ctx.shadowColor = star.color;
                    ctx.shadowBlur = 10 * brightness;
                }
                
                ctx.fillStyle = star.color;
                ctx.beginPath();
                ctx.arc(proj.x, proj.y, size, 0, Math.PI * 2);
                ctx.fill();
                
                // Point central plus lumineux
                if (size > 1.5) {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.beginPath();
                    ctx.arc(proj.x, proj.y, size * 0.4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            
            ctx.restore();
        }
        
        // Continuer l'animation si pas terminée
        if (phaseRef.current !== 'complete' && phaseRef.current !== 'flash') {
            animationRef.current = requestAnimationFrame(render);
        }
    }, [onComplete]);
    
    // ============================================
    // GESTION DU RESIZE
    // ============================================
    
    const handleResize = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
        }
        
        // Réinitialiser les étoiles
        initializeStars(rect.width, rect.height);
    }, [initializeStars]);
    
    // ============================================
    // EFFETS
    // ============================================
    
    // Initialisation
    useEffect(() => {
        handleResize();
        window.addEventListener('resize', handleResize);
        
        // Démarrer l'animation idle
        animationRef.current = requestAnimationFrame(render);
        
        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationRef.current);
        };
    }, [handleResize, render]);
    
    // Déclenchement du warp
    useEffect(() => {
        if (isActive && phaseRef.current === 'idle') {
            phaseRef.current = 'warp';
            setPhase('warp');
            warpStartTimeRef.current = performance.now();
        }
    }, [isActive]);
    
    // ============================================
    // RENDU JSX
    // ============================================
    
    // Merge className styles - if className contains 'fixed', use fixed positioning
    const isFixedPosition = className.includes('fixed');
    
    return (
        <div 
            ref={containerRef}
            className={`hyperspace-container ${className}`}
            style={{
                position: isFixedPosition ? 'fixed' : 'relative',
                top: isFixedPosition ? 0 : undefined,
                left: isFixedPosition ? 0 : undefined,
                right: isFixedPosition ? 0 : undefined,
                bottom: isFixedPosition ? 0 : undefined,
                width: '100vw',
                height: '100vh',
                overflow: 'hidden',
                backgroundColor: '#000510'
            }}
        >
            {/* Canvas de l'animation */}
            <canvas
                ref={canvasRef}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    opacity: canvasOpacity,
                    transition: `opacity ${CONFIG.REVEAL_DURATION}ms ease-out`,
                    pointerEvents: isCanvasActive ? 'auto' : 'none',
                    zIndex: 10,
                    display: 'block'
                }}
            />
            
            {/* Flash blanc */}
            <div
                className="hyperspace-flash"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#FFFFFF',
                    opacity: flashOpacity,
                    transition: `opacity ${CONFIG.FLASH_DURATION}ms ease-out`,
                    pointerEvents: 'none',
                    zIndex: 20
                }}
            />
            
            {/* Contenu révélé */}
            <div
                className={`hyperspace-content ${contentVisible ? 'visible' : ''}`}
                style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    opacity: contentVisible ? 1 : 0,
                    transform: contentVisible ? 'scale(1)' : 'scale(0.95)',
                    transition: `opacity ${CONFIG.REVEAL_DURATION}ms ease-out, transform ${CONFIG.REVEAL_DURATION}ms ease-out`,
                    zIndex: 5
                }}
            >
                {children}
            </div>
            
            {/* Styles pour effets glow */}
            <style>{`
                .hyperspace-container {
                    background: radial-gradient(ellipse at center, #001020 0%, #000510 100%);
                }
                
                .hyperspace-content.visible {
                    animation: hyperspace-reveal-glow 0.8s ease-out;
                }
                
                @keyframes hyperspace-reveal-glow {
                    0% {
                        filter: brightness(2) blur(10px);
                    }
                    50% {
                        filter: brightness(1.5) blur(2px);
                    }
                    100% {
                        filter: brightness(1) blur(0);
                    }
                }
            `}</style>
        </div>
    );
};

export default HyperspaceReveal;
