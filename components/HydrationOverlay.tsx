/**
 * @file HydrationOverlay.tsx
 * @description Loader bloquant affiché pendant l'hydratation des données workspace
 * @domain UI - Hydration Feedback
 * 
 * DESIGN: Style "Blur Racing" Gaming Futuriste
 * - Couleur principale: Vert Émeraude Néon (#50C878)
 * - Effets: Glow, scanlines, particules cybernétiques
 * - Animation: Effet de vitesse
 * - z-index: Maximum (bloque toute interaction)
 * 
 * COMPORTEMENT:
 * - Affiché pendant GET /api/user/workspace
 * - Bloque le canvas tant que l'hydratation n'est pas terminée
 * - Transition smooth à la disparition
 */

import React, { useEffect, useState, useMemo } from 'react';

interface HydrationOverlayProps {
    /** Whether hydration is in progress */
    isLoading: boolean;
    /** Optional loading message */
    message?: string;
    /** Optional progress percentage (0-100) */
    progress?: number;
    /** Callback when overlay is hidden */
    onHidden?: () => void;
}

/**
 * Generate random particles for cybernetic effect
 */
const generateParticles = (count: number) => {
    return Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 1,
        duration: Math.random() * 2 + 1,
        delay: Math.random() * 2
    }));
};

export const HydrationOverlay: React.FC<HydrationOverlayProps> = ({
    isLoading,
    message = 'Chargement du workspace...',
    progress,
    onHidden
}) => {
    const [isVisible, setIsVisible] = useState(isLoading);
    const [isFadingOut, setIsFadingOut] = useState(false);
    
    // Memoize particles to avoid regeneration on re-renders
    const particles = useMemo(() => generateParticles(30), []);

    useEffect(() => {
        if (isLoading) {
            setIsVisible(true);
            setIsFadingOut(false);
            return;
        }

        if (isVisible) {
            // Start fade out animation
            setIsFadingOut(true);
            const timer = setTimeout(() => {
                setIsVisible(false);
                setIsFadingOut(false);
                onHidden?.();
            }, 500); // Match CSS transition duration
            return () => clearTimeout(timer);
        }
    }, [isLoading, isVisible, onHidden]);

    if (!isLoading && !isVisible) return null;

    return (
        <>
            {/* Styles embarqués pour isolation complète */}
            <style>{`
                /* ============================================
                   HYDRATION OVERLAY - BLUR RACING STYLE
                   ============================================ */
                
                @keyframes hydration-pulse {
                    0%, 100% {
                        box-shadow: 
                            0 0 20px rgba(80, 200, 120, 0.4),
                            0 0 40px rgba(80, 200, 120, 0.2),
                            0 0 60px rgba(80, 200, 120, 0.1);
                    }
                    50% {
                        box-shadow: 
                            0 0 30px rgba(80, 200, 120, 0.6),
                            0 0 60px rgba(80, 200, 120, 0.4),
                            0 0 90px rgba(80, 200, 120, 0.2);
                    }
                }

                @keyframes hydration-scanline {
                    0% { transform: translateY(-100%); }
                    100% { transform: translateY(100vh); }
                }

                @keyframes hydration-speed-line {
                    0% { 
                        transform: translateX(-100%) scaleX(0.5);
                        opacity: 0;
                    }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { 
                        transform: translateX(100vw) scaleX(1.5);
                        opacity: 0;
                    }
                }

                @keyframes hydration-particle-float {
                    0%, 100% {
                        transform: translateY(0) translateX(0);
                        opacity: 0.3;
                    }
                    25% {
                        transform: translateY(-20px) translateX(10px);
                        opacity: 0.8;
                    }
                    50% {
                        transform: translateY(-10px) translateX(-5px);
                        opacity: 0.5;
                    }
                    75% {
                        transform: translateY(-30px) translateX(15px);
                        opacity: 0.7;
                    }
                }

                @keyframes hydration-spinner {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                @keyframes hydration-text-glow {
                    0%, 100% {
                        text-shadow: 
                            0 0 10px rgba(80, 200, 120, 0.8),
                            0 0 20px rgba(80, 200, 120, 0.5),
                            0 0 30px rgba(80, 200, 120, 0.3);
                    }
                    50% {
                        text-shadow: 
                            0 0 15px rgba(80, 200, 120, 1),
                            0 0 30px rgba(80, 200, 120, 0.7),
                            0 0 45px rgba(80, 200, 120, 0.5);
                    }
                }

                @keyframes hydration-progress-shine {
                    0% { left: -100%; }
                    100% { left: 100%; }
                }

                .hydration-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 99999; /* Maximum z-index */
                    
                    /* Blur Racing Background */
                    background: 
                        linear-gradient(135deg, 
                            rgba(10, 15, 20, 0.98) 0%,
                            rgba(15, 25, 35, 0.98) 50%,
                            rgba(10, 20, 25, 0.98) 100%
                        );
                    
                    /* Flex center */
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    
                    /* Transition */
                    opacity: 1;
                    transition: opacity 0.5s ease-out;
                    
                    /* Block all interactions */
                    pointer-events: all;
                }

                .hydration-overlay.fading-out {
                    opacity: 0;
                    pointer-events: none;
                }

                /* Scanlines Effect */
                .hydration-scanlines {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    pointer-events: none;
                    overflow: hidden;
                }

                .hydration-scanlines::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 4px;
                    background: linear-gradient(
                        to bottom,
                        transparent,
                        rgba(80, 200, 120, 0.15),
                        transparent
                    );
                    animation: hydration-scanline 3s linear infinite;
                }

                /* Speed Lines */
                .hydration-speed-lines {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    pointer-events: none;
                    overflow: hidden;
                }

                .hydration-speed-line {
                    position: absolute;
                    height: 2px;
                    background: linear-gradient(
                        to right,
                        transparent,
                        rgba(80, 200, 120, 0.6),
                        rgba(80, 200, 120, 0.8),
                        rgba(80, 200, 120, 0.6),
                        transparent
                    );
                    animation: hydration-speed-line 1.5s ease-in-out infinite;
                }

                /* Particles Container */
                .hydration-particles {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    pointer-events: none;
                    overflow: hidden;
                }

                .hydration-particle {
                    position: absolute;
                    border-radius: 50%;
                    background: radial-gradient(
                        circle,
                        rgba(80, 200, 120, 0.8) 0%,
                        rgba(80, 200, 120, 0.4) 50%,
                        transparent 100%
                    );
                    animation: hydration-particle-float ease-in-out infinite;
                }

                /* Main Content Container */
                .hydration-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 24px;
                    z-index: 1;
                }

                /* Spinner Container */
                .hydration-spinner-container {
                    position: relative;
                    width: 100px;
                    height: 100px;
                    animation: hydration-pulse 2s ease-in-out infinite;
                }

                .hydration-spinner-ring {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    border: 3px solid transparent;
                    animation: hydration-spinner linear infinite;
                }

                .hydration-spinner-ring.outer {
                    border-top-color: #50C878;
                    border-right-color: rgba(80, 200, 120, 0.3);
                    animation-duration: 1.2s;
                }

                .hydration-spinner-ring.middle {
                    width: 75%;
                    height: 75%;
                    top: 12.5%;
                    left: 12.5%;
                    border-bottom-color: #50C878;
                    border-left-color: rgba(80, 200, 120, 0.3);
                    animation-duration: 1.5s;
                    animation-direction: reverse;
                }

                .hydration-spinner-ring.inner {
                    width: 50%;
                    height: 50%;
                    top: 25%;
                    left: 25%;
                    border-top-color: #50C878;
                    animation-duration: 0.8s;
                }

                /* Center Icon */
                .hydration-center-icon {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    font-size: 24px;
                    color: #50C878;
                    text-shadow: 0 0 10px rgba(80, 200, 120, 0.8);
                }

                /* Message */
                .hydration-message {
                    font-family: 'Orbitron', 'Rajdhani', 'Inter', sans-serif;
                    font-size: 18px;
                    font-weight: 600;
                    color: #50C878;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    animation: hydration-text-glow 2s ease-in-out infinite;
                }

                /* Progress Bar */
                .hydration-progress-container {
                    width: 250px;
                    height: 6px;
                    background: rgba(80, 200, 120, 0.1);
                    border-radius: 3px;
                    overflow: hidden;
                    border: 1px solid rgba(80, 200, 120, 0.3);
                    position: relative;
                }

                .hydration-progress-bar {
                    height: 100%;
                    background: linear-gradient(
                        90deg,
                        #50C878 0%,
                        #3CB371 50%,
                        #50C878 100%
                    );
                    border-radius: 3px;
                    transition: width 0.3s ease-out;
                    position: relative;
                    overflow: hidden;
                }

                .hydration-progress-bar::after {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: -100%;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(
                        90deg,
                        transparent,
                        rgba(255, 255, 255, 0.4),
                        transparent
                    );
                    animation: hydration-progress-shine 1.5s infinite;
                }

                /* Progress Text */
                .hydration-progress-text {
                    font-family: 'Orbitron', monospace;
                    font-size: 12px;
                    color: rgba(80, 200, 120, 0.8);
                    margin-top: 8px;
                }

                /* Subtitle */
                .hydration-subtitle {
                    font-family: 'Inter', sans-serif;
                    font-size: 12px;
                    color: rgba(80, 200, 120, 0.6);
                    letter-spacing: 1px;
                }
            `}</style>

            <div className={`hydration-overlay ${!isLoading && isFadingOut ? 'fading-out' : ''}`}>
                {/* Scanlines Effect */}
                <div className="hydration-scanlines" />

                {/* Speed Lines */}
                <div className="hydration-speed-lines">
                    {[15, 30, 45, 60, 75].map((top, i) => (
                        <div
                            key={i}
                            className="hydration-speed-line"
                            style={{
                                top: `${top}%`,
                                width: `${Math.random() * 30 + 20}%`,
                                animationDelay: `${i * 0.3}s`
                            }}
                        />
                    ))}
                </div>

                {/* Particles */}
                <div className="hydration-particles">
                    {particles.map(particle => (
                        <div
                            key={particle.id}
                            className="hydration-particle"
                            style={{
                                left: `${particle.x}%`,
                                top: `${particle.y}%`,
                                width: `${particle.size}px`,
                                height: `${particle.size}px`,
                                animationDuration: `${particle.duration}s`,
                                animationDelay: `${particle.delay}s`
                            }}
                        />
                    ))}
                </div>

                {/* Main Content */}
                <div className="hydration-content">
                    {/* Spinner */}
                    <div className="hydration-spinner-container">
                        <div className="hydration-spinner-ring outer" />
                        <div className="hydration-spinner-ring middle" />
                        <div className="hydration-spinner-ring inner" />
                        <div className="hydration-center-icon">⚡</div>
                    </div>

                    {/* Message */}
                    <div className="hydration-message">{message}</div>

                    {/* Progress Bar (if progress provided) */}
                    {progress !== undefined && (
                        <>
                            <div className="hydration-progress-container">
                                <div 
                                    className="hydration-progress-bar"
                                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                                />
                            </div>
                            <div className="hydration-progress-text">
                                {Math.round(progress)}%
                            </div>
                        </>
                    )}

                    {/* Subtitle */}
                    <div className="hydration-subtitle">
                        Synchronisation des données en cours
                    </div>
                </div>
            </div>
        </>
    );
};

export default HydrationOverlay;
