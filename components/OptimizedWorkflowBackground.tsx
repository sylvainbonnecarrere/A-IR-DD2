import React, { useMemo, useEffect, useRef } from 'react';
import { useDayNightTheme, DayNightTheme } from '../hooks/useDayNightTheme';

/**
 * OptimizedWorkflowBackground
 * 
 * Background animé ultra-optimisé avec :
 * - Particules aléatoires stylisées (jeu vidéo Blur/astronomie)
 * - Animations CSS pures (pas de JavaScript loop)
 * - Thème dynamique jour/nuit basé sur heure européenne
 * - GPU accelerated avec transform/opacity
 * - Désactivation animations si batterie faible (économie ressources)
 * 
 * Règles de développement :
 * 1. Utiliser UNIQUEMENT transform/opacity pour animations (GPU)
 * 2. Limiter nombre de particules (max 8 pour performance)
 * 3. Animations CSS avec will-change pour optimisation
 * 4. Pas de re-render inutile (useMemo pour tout)
 * 5. Désactiver si batterie < 20% ou mode économie d'énergie
 */

interface ParticleConfig {
    id: string;
    x: number;
    y: number;
    size: number;
    color: string;
    animationDuration: number;
    animationType: 'pulse' | 'ping' | 'orbit' | 'drift';
    delay: number;
}

const generateParticles = (theme: DayNightTheme): ParticleConfig[] => {
    const particles: ParticleConfig[] = [];
    const animationTypes: ('pulse' | 'ping' | 'orbit' | 'drift')[] = ['pulse', 'ping', 'orbit', 'drift'];

    // Générer 8 particules aléatoires (limite performance)
    for (let i = 0; i < 8; i++) {
        particles.push({
            id: `particle-${i}`,
            x: Math.random() * 100, // Position en %
            y: Math.random() * 100,
            size: Math.random() * 3 + 1, // 1-4px
            color: theme.particleColors[Math.floor(Math.random() * theme.particleColors.length)],
            animationDuration: Math.random() * 3 + 2, // 2-5s
            animationType: animationTypes[Math.floor(Math.random() * animationTypes.length)],
            delay: Math.random() * 2 // 0-2s delay
        });
    }

    return particles;
};

export const OptimizedWorkflowBackground: React.FC = () => {
    const theme = useDayNightTheme();
    const canvasRef = useRef<HTMLDivElement>(null);
    const [shouldAnimate, setShouldAnimate] = React.useState(true);

    // Vérifier batterie et performance
    useEffect(() => {
        const checkPerformance = async () => {
            // @ts-ignore - Battery API non standard
            if ('getBattery' in navigator) {
                try {
                    // @ts-ignore
                    const battery = await navigator.getBattery();
                    const lowBattery = battery.level < 0.2 || battery.charging === false;
                    setShouldAnimate(!lowBattery);

                    // Listener pour changement batterie
                    battery.addEventListener('levelchange', () => {
                        setShouldAnimate(battery.level >= 0.2);
                    });
                } catch (e) {
                    // Si API batterie non disponible, continuer animations
                    setShouldAnimate(true);
                }
            }
        };

        checkPerformance();
    }, []);

    // Générer particules (mémorisé pour éviter re-calcul)
    const particles = useMemo(() => generateParticles(theme), [theme.timeOfDay]);

    // Styles CSS pour animations
    const animationStyles = useMemo(() => `
    @keyframes particle-pulse {
      0%, 100% { 
        opacity: 0.3;
        transform: scale(1);
      }
      50% { 
        opacity: 1;
        transform: scale(1.5);
      }
    }
    
    @keyframes particle-ping {
      0% { 
        opacity: 1;
        transform: scale(0.5);
      }
      75%, 100% {
        opacity: 0;
        transform: scale(2);
      }
    }
    
    @keyframes particle-orbit {
      0% { 
        transform: rotate(0deg) translateX(20px) rotate(0deg);
      }
      100% { 
        transform: rotate(360deg) translateX(20px) rotate(-360deg);
      }
    }
    
    @keyframes particle-drift {
      0%, 100% { 
        transform: translate(0, 0);
        opacity: 0.5;
      }
      50% { 
        transform: translate(10px, -15px);
        opacity: 1;
      }
    }
    
    @keyframes grid-scan {
      0%, 100% { 
        opacity: 0.15;
        transform: translateY(0);
      }
      50% { 
        opacity: 0.3;
        transform: translateY(2px);
      }
    }
    
    @keyframes speed-streak {
      0% { 
        transform: translateX(-100%);
        opacity: 0;
      }
      50% {
        opacity: 0.4;
      }
      100% { 
        transform: translateX(100%);
        opacity: 0;
      }
    }
  `, []);

    return (
        <div
            ref={canvasRef}
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={{ background: theme.backgroundGradient }}
        >
            <style>{animationStyles}</style>

            {/* Grille de fond style racing game */}
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage: `
            repeating-linear-gradient(
              90deg,
              transparent,
              transparent 98px,
              ${theme.gridColor} 100px
            ),
            repeating-linear-gradient(
              0deg,
              transparent,
              transparent 98px,
              ${theme.secondaryColor} 100px
            )
          `,
                    opacity: 0.2,
                    animation: shouldAnimate ? 'grid-scan 4s ease-in-out infinite' : 'none',
                    willChange: 'opacity, transform'
                }}
            />

            {/* Speed streaks (lignes de vitesse) */}
            {shouldAnimate && (
                <>
                    <div
                        className="absolute top-10 left-0 w-full h-0.5"
                        style={{
                            background: `linear-gradient(to right, transparent, ${theme.primaryColor}, transparent)`,
                            animation: 'speed-streak 3s linear infinite',
                            willChange: 'transform, opacity'
                        }}
                    />
                    <div
                        className="absolute bottom-20 left-0 w-full h-0.5"
                        style={{
                            background: `linear-gradient(to right, transparent, ${theme.secondaryColor}, transparent)`,
                            animation: 'speed-streak 4s linear infinite 1s',
                            willChange: 'transform, opacity'
                        }}
                    />
                    <div
                        className="absolute top-1/2 left-0 w-full h-0.5"
                        style={{
                            background: `linear-gradient(to right, transparent, ${theme.accentColor}, transparent)`,
                            animation: 'speed-streak 3.5s linear infinite 0.5s',
                            willChange: 'transform, opacity'
                        }}
                    />
                </>
            )}

            {/* Particules optimisées */}
            {shouldAnimate && particles.map((particle) => (
                <div
                    key={particle.id}
                    className="absolute rounded-full"
                    style={{
                        left: `${particle.x}%`,
                        top: `${particle.y}%`,
                        width: `${particle.size}px`,
                        height: `${particle.size}px`,
                        backgroundColor: particle.color,
                        boxShadow: `0 0 ${particle.size * 4}px ${particle.color}`,
                        animation: `particle-${particle.animationType} ${particle.animationDuration}s ease-in-out infinite ${particle.delay}s`,
                        willChange: 'transform, opacity'
                    }}
                />
            ))}

            {/* Overlay de dégradé ambiant */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: `
            radial-gradient(circle at 25% 25%, ${theme.primaryColor} 0%, transparent 50%),
            radial-gradient(circle at 75% 75%, ${theme.secondaryColor} 0%, transparent 50%),
            radial-gradient(circle at 50% 50%, ${theme.accentColor} 0%, transparent 70%)
          `,
                    opacity: 0.15
                }}
            />
        </div>
    );
};
