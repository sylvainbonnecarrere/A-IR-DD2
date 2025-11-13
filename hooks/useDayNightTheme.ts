import { useState, useEffect } from 'react';

/**
 * Hook de thème dynamique basé sur l'heure européenne
 * 
 * Règles de design :
 * - 05h-12h (Matin) : Couleurs forestières lumineuses (vert, doré, ambre)
 * - 12h-19h (Après-midi) : Transition progressive vers neon
 * - 19h-05h (Nuit) : Couleurs futuristes neon (cyan, fuchsia, violet)
 * 
 * @returns Objet de configuration de thème
 */

export interface DayNightTheme {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    gridColor: string;
    particleColors: string[];
    backgroundGradient: string;
    timeOfDay: 'morning' | 'afternoon' | 'night';
}

const getEuropeanHour = (): number => {
    // Obtenir l'heure en Europe (UTC+1 ou UTC+2 selon DST)
    const now = new Date();
    const europeTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    return europeTime.getHours();
};

const calculateTheme = (hour: number): DayNightTheme => {
    // MATIN (5h-12h) : Couleurs forestières lumineuses
    if (hour >= 5 && hour < 12) {
        return {
            primaryColor: 'rgba(34, 197, 94, 0.3)',   // Vert forêt
            secondaryColor: 'rgba(251, 191, 36, 0.3)', // Doré/Ambre
            accentColor: 'rgba(74, 222, 128, 0.4)',    // Vert clair
            gridColor: 'rgba(34, 197, 94, 0.3)',
            particleColors: ['#22c55e', '#facc15', '#4ade80', '#86efac'],
            backgroundGradient: 'linear-gradient(135deg, rgba(5, 46, 22, 0.95) 0%, rgba(20, 83, 45, 0.9) 50%, rgba(34, 197, 94, 0.2) 100%)',
            timeOfDay: 'morning'
        };
    }

    // APRÈS-MIDI (12h-19h) : Transition progressive
    if (hour >= 12 && hour < 19) {
        // Interpolation progressive de forestier vers neon
        const progress = (hour - 12) / 7; // 0 à 1

        // Couleurs de transition
        const greenToBlue = interpolateColor([34, 197, 94], [0, 255, 255], progress);
        const amberToPink = interpolateColor([251, 191, 36], [255, 0, 255], progress);

        return {
            primaryColor: `rgba(${greenToBlue.join(',')}, 0.3)`,
            secondaryColor: `rgba(${amberToPink.join(',')}, 0.3)`,
            accentColor: `rgba(${greenToBlue.join(',')}, 0.4)`,
            gridColor: `rgba(${greenToBlue.join(',')}, 0.3)`,
            particleColors: [
                `rgb(${greenToBlue.join(',')})`,
                `rgb(${amberToPink.join(',')})`,
                '#a78bfa',
                '#c084fc'
            ],
            backgroundGradient: `linear-gradient(135deg, rgba(${Math.floor(5 + progress * 10)}, ${Math.floor(46 - progress * 46)}, ${Math.floor(22 - progress * 22)}, 0.95) 0%, rgba(26, 26, 26, 0.9) 50%, rgba(${Math.floor(34 - progress * 34)}, ${Math.floor(197 - progress * 146)}, ${Math.floor(94 + progress * 161)}, 0.2) 100%)`,
            timeOfDay: 'afternoon'
        };
    }

    // NUIT (19h-5h) : Couleurs futuristes neon
    return {
        primaryColor: 'rgba(0, 255, 255, 0.3)',     // Cyan
        secondaryColor: 'rgba(255, 0, 255, 0.3)',   // Fuchsia/Magenta
        accentColor: 'rgba(168, 85, 247, 0.4)',     // Violet
        gridColor: 'rgba(0, 255, 255, 0.3)',
        particleColors: ['#00ffff', '#ff00ff', '#a855f7', '#c084fc'],
        backgroundGradient: 'linear-gradient(135deg, rgba(0, 0, 0, 0.95) 0%, rgba(26, 26, 26, 0.9) 50%, rgba(51, 51, 51, 0.95) 100%)',
        timeOfDay: 'night'
    };
};

// Fonction d'interpolation de couleurs RGB
const interpolateColor = (color1: number[], color2: number[], progress: number): number[] => {
    return [
        Math.round(color1[0] + (color2[0] - color1[0]) * progress),
        Math.round(color1[1] + (color2[1] - color1[1]) * progress),
        Math.round(color1[2] + (color2[2] - color1[2]) * progress)
    ];
};

export const useDayNightTheme = (): DayNightTheme => {
    const [theme, setTheme] = useState<DayNightTheme>(() => {
        const hour = getEuropeanHour();
        return calculateTheme(hour);
    });

    useEffect(() => {
        // Mettre à jour le thème immédiatement
        const updateTheme = () => {
            const hour = getEuropeanHour();
            setTheme(calculateTheme(hour));
        };

        // Vérifier toutes les 5 minutes (optimisé)
        const interval = setInterval(updateTheme, 5 * 60 * 1000);

        return () => clearInterval(interval);
    }, []);

    return theme;
};
