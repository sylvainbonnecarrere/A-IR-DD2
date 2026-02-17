/**
 * @file WelcomeExperience.tsx
 * @description Expérience d'accueil pour les utilisateurs invités
 * @domain UX - Guest Onboarding
 * 
 * LAYOUT:
 * - Marges latérales de 20% (contenu centré sur 60%)
 * - Sidebar de navigation futuriste avec glow cyan
 * - Animation Hyperspace pour révéler l'interface
 * 
 * INTÉGRATION:
 * - Utilisé dans App.tsx pour les utilisateurs non connectés
 * - Déclenche l'hyperspace après un délai configurable
 */

import React, { useState, useEffect, useCallback } from 'react';
import { HyperspaceReveal } from './HyperspaceReveal';
import { useLocalization } from '../hooks/useLocalization';

// ============================================
// TYPES
// ============================================

interface WelcomeExperienceProps {
    /** Délai avant déclenchement automatique (ms) */
    autoTriggerDelay?: number;
    /** Callback après animation terminée */
    onExperienceComplete?: () => void;
    /** Mode manuel (bouton pour déclencher) */
    manualTrigger?: boolean;
    /** Contenu personnalisé après reveal */
    children?: React.ReactNode;
}

interface NavItem {
    id: string;
    icon: string;
    label: string;
    description: string;
}

// ============================================
// DONNÉES DE NAVIGATION
// ============================================

const NAV_ITEMS: NavItem[] = [
    {
        id: 'workflows',
        icon: '⚡',
        label: 'Workflows',
        description: 'Créez et orchestrez vos agents IA'
    },
    {
        id: 'agents',
        icon: '🤖',
        label: 'Agents',
        description: 'Configurez vos assistants intelligents'
    },
    {
        id: 'connections',
        icon: '🔗',
        label: 'Connexions',
        description: 'Intégrez vos APIs et services'
    },
    {
        id: 'templates',
        icon: '📋',
        label: 'Templates',
        description: 'Démarrez avec des modèles prêts'
    },
    {
        id: 'settings',
        icon: '⚙️',
        label: t('settings_tab_label'),
        description: 'Personnalisez votre expérience'
    }
];

// ============================================
// COMPOSANT SIDEBAR FUTURISTE
// ============================================

const FuturisticSidebar: React.FC<{ visible: boolean }> = ({ visible }) => {
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);
    const [selectedItem, setSelectedItem] = useState<string>('workflows');
    
    return (
        <nav 
            className={`futuristic-sidebar ${visible ? 'visible' : ''}`}
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '24px 16px',
                background: 'linear-gradient(180deg, rgba(0, 20, 40, 0.95) 0%, rgba(0, 10, 25, 0.98) 100%)',
                borderRight: '1px solid rgba(0, 217, 255, 0.2)',
                boxShadow: '4px 0 30px rgba(0, 217, 255, 0.1)',
                minWidth: '280px',
                height: '100%',
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
        >
            {/* Logo / Titre */}
            <div 
                className="sidebar-header"
                style={{
                    marginBottom: '32px',
                    paddingBottom: '24px',
                    borderBottom: '1px solid rgba(0, 217, 255, 0.15)'
                }}
            >
                <h1 
                    className="neon-title"
                    style={{
                        fontSize: '28px',
                        fontWeight: 700,
                        letterSpacing: '3px',
                        margin: 0,
                        color: '#00D9FF',
                        textShadow: `
                            0 0 10px rgba(0, 217, 255, 0.8),
                            0 0 20px rgba(0, 217, 255, 0.5),
                            0 0 40px rgba(0, 217, 255, 0.3)
                        `,
                        animation: 'neon-pulse 2s ease-in-out infinite'
                    }}
                >
                    A-IR-DD2
                </h1>
                <p style={{
                    margin: '8px 0 0',
                    fontSize: '12px',
                    color: 'rgba(0, 217, 255, 0.6)',
                    letterSpacing: '2px',
                    textTransform: 'uppercase'
                }}>
                    AI Workflow Studio
                </p>
            </div>
            
            {/* Navigation Items */}
            {NAV_ITEMS.map((item, index) => (
                <button
                    key={item.id}
                    onClick={() => setSelectedItem(item.id)}
                    onMouseEnter={() => setHoveredItem(item.id)}
                    onMouseLeave={() => setHoveredItem(null)}
                    className={`nav-item ${selectedItem === item.id ? 'selected' : ''}`}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        padding: '16px 20px',
                        background: selectedItem === item.id 
                            ? 'linear-gradient(90deg, rgba(0, 217, 255, 0.15) 0%, transparent 100%)'
                            : hoveredItem === item.id 
                                ? 'rgba(0, 217, 255, 0.05)'
                                : 'transparent',
                        border: 'none',
                        borderLeft: selectedItem === item.id 
                            ? '3px solid #00D9FF' 
                            : '3px solid transparent',
                        borderRadius: '0 8px 8px 0',
                        cursor: 'pointer',
                        textAlign: 'left',
                        opacity: visible ? 1 : 0,
                        transform: visible ? 'translateX(0)' : 'translateX(-20px)',
                        transition: `all 0.3s ease, opacity 0.5s ease ${index * 0.1}s, transform 0.5s ease ${index * 0.1}s`,
                        boxShadow: selectedItem === item.id 
                            ? '0 0 20px rgba(0, 217, 255, 0.2)' 
                            : 'none'
                    }}
                >
                    <span style={{
                        fontSize: '24px',
                        filter: selectedItem === item.id ? 'drop-shadow(0 0 8px rgba(0, 217, 255, 0.8))' : 'none',
                        transition: 'filter 0.3s ease'
                    }}>
                        {item.icon}
                    </span>
                    <div style={{ flex: 1 }}>
                        <div style={{
                            fontSize: '15px',
                            fontWeight: 600,
                            color: selectedItem === item.id ? '#00D9FF' : '#E0FFFF',
                            marginBottom: '4px',
                            textShadow: selectedItem === item.id 
                                ? '0 0 10px rgba(0, 217, 255, 0.5)' 
                                : 'none',
                            transition: 'all 0.3s ease'
                        }}>
                            {item.label}
                        </div>
                        <div style={{
                            fontSize: '12px',
                            color: 'rgba(224, 255, 255, 0.5)',
                            lineHeight: 1.3
                        }}>
                            {item.description}
                        </div>
                    </div>
                    
                    {/* Indicateur de sélection */}
                    {selectedItem === item.id && (
                        <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: '#00D9FF',
                            boxShadow: '0 0 10px #00D9FF, 0 0 20px #00D9FF',
                            animation: 'pulse-glow 1.5s ease-in-out infinite'
                        }} />
                    )}
                </button>
            ))}
            
            {/* Footer */}
            <div style={{
                marginTop: 'auto',
                paddingTop: '24px',
                borderTop: '1px solid rgba(0, 217, 255, 0.15)'
            }}>
                <button
                    style={{
                        width: '100%',
                        padding: '14px 20px',
                        background: 'linear-gradient(135deg, rgba(0, 217, 255, 0.2) 0%, rgba(0, 150, 200, 0.2) 100%)',
                        border: '1px solid rgba(0, 217, 255, 0.3)',
                        borderRadius: '8px',
                        color: '#00D9FF',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.3s ease',
                        textShadow: '0 0 10px rgba(0, 217, 255, 0.5)'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 217, 255, 0.3) 0%, rgba(0, 150, 200, 0.3) 100%)';
                        e.currentTarget.style.boxShadow = '0 0 30px rgba(0, 217, 255, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 217, 255, 0.2) 0%, rgba(0, 150, 200, 0.2) 100%)';
                        e.currentTarget.style.boxShadow = 'none';
                    }}
                >
                    🚀 Démarrer un Workflow
                </button>
            </div>
        </nav>
    );
};

// ============================================
// COMPOSANT CONTENU PRINCIPAL
// ============================================

const MainContent: React.FC<{ visible: boolean }> = ({ visible }) => {
    return (
        <main 
            className={`main-content ${visible ? 'visible' : ''}`}
            style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '48px',
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(20px)',
                transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s'
            }}
        >
            {/* Hero Section */}
            <div style={{
                textAlign: 'center',
                maxWidth: '600px'
            }}>
                <h2 style={{
                    fontSize: '42px',
                    fontWeight: 300,
                    color: '#E0FFFF',
                    marginBottom: '16px',
                    letterSpacing: '2px'
                }}>
                    Bienvenue dans le <span style={{
                        fontWeight: 700,
                        color: '#00D9FF',
                        textShadow: '0 0 30px rgba(0, 217, 255, 0.5)'
                    }}>Futur</span>
                </h2>
                
                <p style={{
                    fontSize: '18px',
                    color: 'rgba(224, 255, 255, 0.7)',
                    lineHeight: 1.6,
                    marginBottom: '40px'
                }}>
                    Orchestrez vos agents IA avec une interface visuelle puissante.
                    Créez, connectez et déployez en quelques clics.
                </p>
                
                {/* Feature Cards */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '20px',
                    marginTop: '32px'
                }}>
                    {[
                        { icon: '🧠', title: 'Multi-LLM', desc: 'GPT, Claude, Gemini...' },
                        { icon: '⚡', title: 'Temps Réel', desc: 'Streaming natif' },
                        { icon: '🔒', title: 'Sécurisé', desc: 'Vos données protégées' }
                    ].map((feature, i) => (
                        <div
                            key={feature.title}
                            className="feature-card"
                            style={{
                                padding: '24px 16px',
                                background: 'rgba(0, 20, 40, 0.5)',
                                border: '1px solid rgba(0, 217, 255, 0.2)',
                                borderRadius: '12px',
                                opacity: visible ? 1 : 0,
                                transform: visible ? 'translateY(0)' : 'translateY(20px)',
                                transition: `all 0.5s ease ${0.5 + i * 0.1}s`
                            }}
                        >
                            <div style={{ fontSize: '32px', marginBottom: '12px' }}>
                                {feature.icon}
                            </div>
                            <div style={{
                                fontSize: '16px',
                                fontWeight: 600,
                                color: '#00D9FF',
                                marginBottom: '4px'
                            }}>
                                {feature.title}
                            </div>
                            <div style={{
                                fontSize: '13px',
                                color: 'rgba(224, 255, 255, 0.5)'
                            }}>
                                {feature.desc}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
};

// ============================================
// COMPOSANT PRINCIPAL - WelcomeExperience
// ============================================

export const WelcomeExperience: React.FC<WelcomeExperienceProps> = ({
    autoTriggerDelay = 2000,
    onExperienceComplete,
    manualTrigger = false,
    children
}) => {
    const [isWarpActive, setIsWarpActive] = useState(false);
    const [isRevealed, setIsRevealed] = useState(false);
    const [showContent, setShowContent] = useState(false);
    
    // Déclenchement automatique
    useEffect(() => {
        if (!manualTrigger && !isWarpActive) {
            const timer = setTimeout(() => {
                setIsWarpActive(true);
            }, autoTriggerDelay);
            
            return () => clearTimeout(timer);
        }
    }, [autoTriggerDelay, manualTrigger, isWarpActive]);
    
    // Callback de fin d'animation
    const handleComplete = useCallback(() => {
        setIsRevealed(true);
        // Petit délai pour l'apparition du contenu
        setTimeout(() => {
            setShowContent(true);
            onExperienceComplete?.();
        }, 100);
    }, [onExperienceComplete]);
    
    // Déclenchement manuel
    const triggerWarp = useCallback(() => {
        if (!isWarpActive) {
            setIsWarpActive(true);
        }
    }, [isWarpActive]);
    
    return (
        <div 
            className="welcome-experience"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 9999
            }}
        >
            <HyperspaceReveal
                isActive={isWarpActive}
                onComplete={handleComplete}
            >
                {/* Layout avec marges 20% */}
                <div 
                    className="welcome-layout"
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        padding: '0 20%',
                        boxSizing: 'border-box',
                        background: 'linear-gradient(135deg, #000a15 0%, #001525 50%, #000a15 100%)'
                    }}
                >
                    {/* Sidebar */}
                    <FuturisticSidebar visible={showContent} />
                    
                    {/* Contenu principal ou children */}
                    {children || <MainContent visible={showContent} />}
                </div>
            </HyperspaceReveal>
            
            {/* Bouton de déclenchement manuel */}
            {manualTrigger && !isWarpActive && (
                <button
                    onClick={triggerWarp}
                    style={{
                        position: 'absolute',
                        bottom: '40px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        padding: '16px 48px',
                        background: 'linear-gradient(135deg, rgba(0, 217, 255, 0.3) 0%, rgba(0, 100, 150, 0.3) 100%)',
                        border: '2px solid rgba(0, 217, 255, 0.5)',
                        borderRadius: '30px',
                        color: '#00D9FF',
                        fontSize: '18px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        letterSpacing: '3px',
                        textTransform: 'uppercase',
                        zIndex: 100,
                        animation: 'button-pulse 2s ease-in-out infinite',
                        boxShadow: '0 0 30px rgba(0, 217, 255, 0.3)',
                        transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = '0 0 50px rgba(0, 217, 255, 0.5)';
                        e.currentTarget.style.borderColor = '#00D9FF';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = '0 0 30px rgba(0, 217, 255, 0.3)';
                        e.currentTarget.style.borderColor = 'rgba(0, 217, 255, 0.5)';
                    }}
                >
                    🚀 Entrer
                </button>
            )}
            
            {/* Styles globaux pour animations */}
            <style>{`
                @keyframes neon-pulse {
                    0%, 100% {
                        text-shadow:
                            0 0 10px rgba(0, 217, 255, 0.8),
                            0 0 20px rgba(0, 217, 255, 0.5),
                            0 0 40px rgba(0, 217, 255, 0.3);
                    }
                    50% {
                        text-shadow:
                            0 0 15px rgba(0, 217, 255, 1),
                            0 0 30px rgba(0, 217, 255, 0.7),
                            0 0 60px rgba(0, 217, 255, 0.5);
                    }
                }
                
                @keyframes pulse-glow {
                    0%, 100% {
                        opacity: 1;
                        box-shadow: 0 0 10px #00D9FF, 0 0 20px #00D9FF;
                    }
                    50% {
                        opacity: 0.7;
                        box-shadow: 0 0 15px #00D9FF, 0 0 30px #00D9FF;
                    }
                }
                
                @keyframes button-pulse {
                    0%, 100% {
                        transform: translateX(-50%) scale(1);
                    }
                    50% {
                        transform: translateX(-50%) scale(1.02);
                    }
                }
                
                .feature-card:hover {
                    border-color: rgba(0, 217, 255, 0.5) !important;
                    box-shadow: 0 0 30px rgba(0, 217, 255, 0.2);
                    transform: translateY(-4px) !important;
                }
                
                .nav-item:focus {
                    outline: none;
                    box-shadow: 0 0 0 2px rgba(0, 217, 255, 0.5);
                }
            `}</style>
        </div>
    );
};

export default WelcomeExperience;
