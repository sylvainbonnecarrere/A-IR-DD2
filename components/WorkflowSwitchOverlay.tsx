/**
 * @file WorkflowSwitchOverlay.tsx
 * @description Loader bloquant affiché pendant le switch de workflow (charte Bos jaune)
 * @domain UI - Workflow Switch Feedback
 * 
 * DESIGN: Style "Blur Racing" Gaming Futuriste — Variante BOS
 * - Couleur principale: Amber/Jaune Bos (#F59E0B)
 * - Couleur secondaire: Amber Dark (#D97706)
 * - Effets: Glow, scanlines, particules cybernétiques (jaune)
 * - Animation: Effet de vitesse
 * - z-index: Maximum (bloque toute interaction)
 * 
 * COMPORTEMENT:
 * - Affiché pendant POST /api/workflows/:id/select
 * - Bloque le canvas tant que le switch n'est pas terminé
 * - Transition smooth à la disparition
 * 
 * PATTERN: Open/Closed — composant séparé de HydrationOverlay (pas de modification)
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';

interface WorkflowSwitchOverlayProps {
    /** Whether workflow switch is in progress */
    isLoading: boolean;
    /** Name of the target workflow displayed dynamically */
    workflowName: string;
    /** Optional progress percentage (0-100) */
    progress?: number;
    /** Callback when overlay is hidden after fade-out */
    onHidden?: () => void;
}

/**
 * Generate random particles for cybernetic effect (Bos amber)
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

export const WorkflowSwitchOverlay: React.FC<WorkflowSwitchOverlayProps> = ({
    isLoading,
    workflowName,
    progress,
    onHidden
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isFadingOut, setIsFadingOut] = useState(false);
    const wasLoadingRef = useRef(false);

    // Memoize particles to avoid regeneration on re-renders
    const particles = useMemo(() => generateParticles(30), []);

    useEffect(() => {
        if (!isLoading && wasLoadingRef.current) {
            // Start fade out animation
            setIsFadingOut(true);
            const timer = setTimeout(() => {
                setIsFadingOut(false);
                setIsVisible(false);
                onHidden?.();
            }, 500); // Match CSS transition duration
            return () => clearTimeout(timer);
        }
        if (isLoading) {
            setIsVisible(true);
            wasLoadingRef.current = true;
        }
    }, [isLoading, onHidden]);

    if (!isVisible) return null;

    return (
        <>
            {/* Styles embarqués pour isolation complète — charte Bos jaune */}
            <style>{`
                /* ============================================
                   WORKFLOW SWITCH OVERLAY - BOS AMBER STYLE
                   ============================================ */
                
                @keyframes wf-switch-pulse {
                    0%, 100% {
                        box-shadow: 
                            0 0 20px rgba(245, 158, 11, 0.4),
                            0 0 40px rgba(245, 158, 11, 0.2),
                            0 0 60px rgba(245, 158, 11, 0.1);
                    }
                    50% {
                        box-shadow: 
                            0 0 30px rgba(245, 158, 11, 0.6),
                            0 0 60px rgba(245, 158, 11, 0.4),
                            0 0 90px rgba(245, 158, 11, 0.2);
                    }
                }

                @keyframes wf-switch-scanline {
                    0% { transform: translateY(-100%); }
                    100% { transform: translateY(100vh); }
                }

                @keyframes wf-switch-speed-line {
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

                @keyframes wf-switch-particle-float {
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

                @keyframes wf-switch-spinner {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                @keyframes wf-switch-text-glow {
                    0%, 100% {
                        text-shadow: 
                            0 0 10px rgba(245, 158, 11, 0.8),
                            0 0 20px rgba(245, 158, 11, 0.5),
                            0 0 30px rgba(245, 158, 11, 0.3);
                    }
                    50% {
                        text-shadow: 
                            0 0 15px rgba(245, 158, 11, 1),
                            0 0 30px rgba(245, 158, 11, 0.7),
                            0 0 45px rgba(245, 158, 11, 0.5);
                    }
                }

                @keyframes wf-switch-progress-shine {
                    0% { left: -100%; }
                    100% { left: 100%; }
                }

                .wf-switch-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 99999; /* Maximum z-index — identique HydrationOverlay */
                    
                    /* Blur Racing Background (identique HydrationOverlay) */
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

                .wf-switch-overlay.fading-out {
                    opacity: 0;
                    pointer-events: none;
                }

                /* Scanlines Effect */
                .wf-switch-scanlines {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    pointer-events: none;
                    overflow: hidden;
                }

                .wf-switch-scanlines::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 4px;
                    background: linear-gradient(
                        to bottom,
                        transparent,
                        rgba(245, 158, 11, 0.15),
                        transparent
                    );
                    animation: wf-switch-scanline 3s linear infinite;
                }

                /* Speed Lines */
                .wf-switch-speed-lines {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    pointer-events: none;
                    overflow: hidden;
                }

                .wf-switch-speed-line {
                    position: absolute;
                    height: 2px;
                    background: linear-gradient(
                        to right,
                        transparent,
                        rgba(245, 158, 11, 0.6),
                        rgba(245, 158, 11, 0.8),
                        rgba(245, 158, 11, 0.6),
                        transparent
                    );
                    animation: wf-switch-speed-line 1.5s ease-in-out infinite;
                }

                /* Particles Container */
                .wf-switch-particles {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    pointer-events: none;
                    overflow: hidden;
                }

                .wf-switch-particle {
                    position: absolute;
                    border-radius: 50%;
                    background: radial-gradient(
                        circle,
                        rgba(245, 158, 11, 0.8) 0%,
                        rgba(245, 158, 11, 0.4) 50%,
                        transparent 100%
                    );
                    animation: wf-switch-particle-float ease-in-out infinite;
                }

                /* Main Content Container */
                .wf-switch-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 24px;
                    z-index: 1;
                }

                /* Spinner Container */
                .wf-switch-spinner-container {
                    position: relative;
                    width: 100px;
                    height: 100px;
                    animation: wf-switch-pulse 2s ease-in-out infinite;
                }

                .wf-switch-spinner-ring {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    border: 3px solid transparent;
                    animation: wf-switch-spinner linear infinite;
                }

                .wf-switch-spinner-ring.outer {
                    border-top-color: #F59E0B;
                    border-right-color: rgba(245, 158, 11, 0.3);
                    animation-duration: 1.2s;
                }

                .wf-switch-spinner-ring.middle {
                    width: 75%;
                    height: 75%;
                    top: 12.5%;
                    left: 12.5%;
                    border-bottom-color: #F59E0B;
                    border-left-color: rgba(245, 158, 11, 0.3);
                    animation-duration: 1.5s;
                    animation-direction: reverse;
                }

                .wf-switch-spinner-ring.inner {
                    width: 50%;
                    height: 50%;
                    top: 25%;
                    left: 25%;
                    border-top-color: #F59E0B;
                    animation-duration: 0.8s;
                }

                /* Center Icon */
                .wf-switch-center-icon {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    font-size: 24px;
                    color: #F59E0B;
                    text-shadow: 0 0 10px rgba(245, 158, 11, 0.8);
                }

                /* Workflow Name (main title) */
                .wf-switch-workflow-name {
                    font-family: 'Orbitron', 'Rajdhani', 'Inter', sans-serif;
                    font-size: 20px;
                    font-weight: 700;
                    color: #F59E0B;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    animation: wf-switch-text-glow 2s ease-in-out infinite;
                    text-align: center;
                    max-width: 400px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                /* Subtitle */
                .wf-switch-subtitle {
                    font-family: 'Inter', sans-serif;
                    font-size: 13px;
                    color: rgba(245, 158, 11, 0.6);
                    letter-spacing: 1px;
                }

                /* Progress Bar */
                .wf-switch-progress-container {
                    width: 250px;
                    height: 6px;
                    background: rgba(245, 158, 11, 0.1);
                    border-radius: 3px;
                    overflow: hidden;
                    border: 1px solid rgba(245, 158, 11, 0.3);
                    position: relative;
                }

                .wf-switch-progress-bar {
                    height: 100%;
                    background: linear-gradient(
                        90deg,
                        #F59E0B 0%,
                        #D97706 50%,
                        #F59E0B 100%
                    );
                    border-radius: 3px;
                    transition: width 0.3s ease-out;
                    position: relative;
                    overflow: hidden;
                }

                .wf-switch-progress-bar::after {
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
                    animation: wf-switch-progress-shine 1.5s infinite;
                }

                /* Progress Text */
                .wf-switch-progress-text {
                    font-family: 'Orbitron', monospace;
                    font-size: 12px;
                    color: rgba(245, 158, 11, 0.8);
                    margin-top: 8px;
                }
            `}</style>

            <div className={`wf-switch-overlay ${isFadingOut ? 'fading-out' : ''}`}>
                {/* Scanlines Effect */}
                <div className="wf-switch-scanlines" />

                {/* Speed Lines */}
                <div className="wf-switch-speed-lines">
                    {[15, 30, 45, 60, 75].map((top, i) => (
                        <div
                            key={i}
                            className="wf-switch-speed-line"
                            style={{
                                top: `${top}%`,
                                width: `${Math.random() * 30 + 20}%`,
                                animationDelay: `${i * 0.3}s`
                            }}
                        />
                    ))}
                </div>

                {/* Particles */}
                <div className="wf-switch-particles">
                    {particles.map(particle => (
                        <div
                            key={particle.id}
                            className="wf-switch-particle"
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
                <div className="wf-switch-content">
                    {/* Spinner */}
                    <div className="wf-switch-spinner-container">
                        <div className="wf-switch-spinner-ring outer" />
                        <div className="wf-switch-spinner-ring middle" />
                        <div className="wf-switch-spinner-ring inner" />
                        <div className="wf-switch-center-icon">🔄</div>
                    </div>

                    {/* Workflow Name (dynamic) */}
                    <div className="wf-switch-workflow-name">{workflowName}</div>

                    {/* Progress Bar (if progress provided) */}
                    {progress !== undefined && (
                        <>
                            <div className="wf-switch-progress-container">
                                <div 
                                    className="wf-switch-progress-bar"
                                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                                />
                            </div>
                            <div className="wf-switch-progress-text">
                                {Math.round(progress)}%
                            </div>
                        </>
                    )}

                    {/* Subtitle */}
                    <div className="wf-switch-subtitle">
                        Synchronisation des données en cours
                    </div>
                </div>
            </div>
        </>
    );
};

export default WorkflowSwitchOverlay;
