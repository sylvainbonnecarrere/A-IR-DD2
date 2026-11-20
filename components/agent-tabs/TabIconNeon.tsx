import React, { useId } from 'react';

/**
 * NeonIcon — icône néon verre « TabIconBlurNeon » (charte Guides/UX/ELEMENTS.md).
 *
 * Utilisée :
 * - par la modale de configuration agent (TabIconNeon, ton bleu, 9 onglets, états pilotés
 *   par .agent-tab-btn / .tab-active / :hover / :disabled) ;
 * - par les contrôles de run de la carte workflow (RunControls, ton vert, play/pause/stop,
 *   états pilotés par .run-control-btn / :hover / :disabled).
 *
 * - Cadre verre/néon uniforme (template 240×240) ; teinte paramétrable (tone blue|green).
 * - États pilotés par CSS (index.css, préfixe .neon-icon) :
 *     défaut   → bordure blanche assombrie, glow réduit, glyphe terne
 *     :hover   → luminosité restaurée (blanc / accent du ton) + sheen
 *     .tab-active → bordure/glow de la couleur d'accent du ton, glow fort
 * - Glyphes « enseigne lumineuse » : lueur d'accent (stroke 6) + cœur blanc (stroke 2.4).
 * - Les id internes (dégradés/clip) sont uniquifiés par useId → pas de collision entre instances.
 */

export type AgentTabIconName =
    | 'config'
    | 'historique'
    | 'fonctions'
    | 'formatage'
    | 'persistence'
    | 'links'
    | 'tasks'
    | 'logs'
    | 'errors';

export type NeonGlyphName = AgentTabIconName | 'play' | 'pause' | 'stop';

export type NeonTone = 'blue' | 'green';

type GlyphEl =
    | { t: 'p'; d: string; f: 'n' | 'd'; tf?: string }
    | { t: 'pg'; points: string; f: 'n' | 'd' }
    | { t: 'c'; cx: number; cy: number; r: number; f: 'n' | 'd' }
    | { t: 'e'; cx: number; cy: number; rx: number; ry: number; f: 'n' | 'd' }
    | { t: 'r'; x: number; y: number; w: number; h: number; rx: number; f: 'n' | 'd'; tf?: string };

interface TonePalette {
    glassA: string;
    glassB: string;
    glassC: string;
    bottom: string;
    fillDark: string;
    fillOpacity: number;
}

const TONES: Record<NeonTone, TonePalette> = {
    blue: { glassA: '#a5f3fc', glassB: '#0e7490', glassC: '#22d3ee', bottom: '#cffafe', fillDark: '#082f49', fillOpacity: 0.4 },
    green: { glassA: '#a3e635', glassB: '#4d7c0f', glassC: '#84cc16', bottom: '#ecfccb', fillDark: '#1a2e05', fillOpacity: 0.45 },
};

/** Glyphes dessinés en coordonnées 240×240, centrés sur (120, 120). */
const GLYPHS: Record<NeonGlyphName, { scale: number; els: GlyphEl[] }> = {
    // Roue crantée
    config: {
        scale: 0.88,
        els: [
            { t: 'c', cx: 120, cy: 120, r: 34, f: 'n' },
            { t: 'c', cx: 120, cy: 120, r: 12, f: 'n' },
            { t: 'p', d: 'M 154 120 L 168 120', f: 'n' },
            { t: 'p', d: 'M 144 144 L 154 154', f: 'n' },
            { t: 'p', d: 'M 120 154 L 120 168', f: 'n' },
            { t: 'p', d: 'M 96 144 L 86 154', f: 'n' },
            { t: 'p', d: 'M 86 120 L 72 120', f: 'n' },
            { t: 'p', d: 'M 96 96 L 86 86', f: 'n' },
            { t: 'p', d: 'M 120 86 L 120 72', f: 'n' },
            { t: 'p', d: 'M 144 96 L 154 86', f: 'n' },
        ],
    },
    // Livre ouvert (sans lignes de texte)
    historique: {
        scale: 0.92,
        els: [
            { t: 'p', d: 'M 120 86 C 101 73 79 73 66 81 L 66 160 C 79 152 101 152 120 165 C 139 152 161 152 174 160 L 174 81 C 161 73 139 73 120 86 Z', f: 'd' },
            { t: 'p', d: 'M 120 86 L 120 165', f: 'n' },
        ],
    },
    // Simple clé à molette
    fonctions: {
        scale: 0.9,
        els: [
            { t: 'p', d: 'M 106 62 A 21 21 0 0 0 108 100 L 108 166 A 12 12 0 0 0 132 166 L 132 100 A 21 21 0 0 0 134 62 L 127 79 L 113 79 Z', f: 'd', tf: 'rotate(-38 120 120)' },
        ],
    },
    // Chevrons de décodage </>
    formatage: {
        scale: 0.88,
        els: [
            { t: 'p', d: 'M 96 88 L 66 120 L 96 152', f: 'n' },
            { t: 'p', d: 'M 144 88 L 174 120 L 144 152', f: 'n' },
            { t: 'p', d: 'M 136 80 L 104 160', f: 'n' },
        ],
    },
    // Base de données (cylindre)
    persistence: {
        scale: 0.88,
        els: [
            { t: 'e', cx: 120, cy: 84, rx: 36, ry: 12, f: 'n' },
            { t: 'p', d: 'M 84 84 L 84 156', f: 'n' },
            { t: 'p', d: 'M 156 84 L 156 156', f: 'n' },
            { t: 'p', d: 'M 84 156 A 36 12 0 0 0 156 156', f: 'n' },
            { t: 'p', d: 'M 84 108 A 36 12 0 0 0 156 108', f: 'n' },
            { t: 'p', d: 'M 84 132 A 36 12 0 0 0 156 132', f: 'n' },
        ],
    },
    // Maillon de chaîne (2 anneaux obliques)
    links: {
        scale: 0.88,
        els: [
            { t: 'r', x: 76, y: 104, w: 52, h: 32, rx: 16, f: 'n', tf: 'rotate(-45 102 120)' },
            { t: 'r', x: 112, y: 104, w: 52, h: 32, rx: 16, f: 'n', tf: 'rotate(-45 138 120)' },
        ],
    },
    // Coche
    tasks: {
        scale: 0.88,
        els: [{ t: 'p', d: 'M 80 122 L 110 152 L 164 92', f: 'n' }],
    },
    // Document avec lignes (logs)
    logs: {
        scale: 0.88,
        els: [
            { t: 'r', x: 80, y: 68, w: 80, h: 104, rx: 10, f: 'd' },
            { t: 'p', d: 'M 96 94 L 144 94', f: 'n' },
            { t: 'p', d: 'M 96 116 L 144 116', f: 'n' },
            { t: 'p', d: 'M 96 138 L 124 138', f: 'n' },
        ],
    },
    // Croix d'erreur
    errors: {
        scale: 0.88,
        els: [
            { t: 'p', d: 'M 82 82 L 158 158', f: 'n' },
            { t: 'p', d: 'M 158 82 L 82 158', f: 'n' },
        ],
    },
    // Triangle lecture (run play)
    play: {
        scale: 0.88,
        els: [{ t: 'pg', points: '94,76 94,164 166,120', f: 'd' }],
    },
    // Deux barres verticales | | (run pause)
    pause: {
        scale: 0.88,
        els: [
            { t: 'r', x: 86, y: 80, w: 22, h: 80, rx: 6, f: 'd' },
            { t: 'r', x: 132, y: 80, w: 22, h: 80, rx: 6, f: 'd' },
        ],
    },
    // Rond (run stop)
    stop: {
        scale: 0.88,
        els: [{ t: 'c', cx: 120, cy: 120, r: 38, f: 'n' }],
    },
};

function renderGlyphEls(els: GlyphEl[], layer: 'under' | 'core', palette: TonePalette): React.ReactNode {
    return els.map((el, i) => {
        const fillProps = el.f === 'd'
            ? { fill: palette.fillDark, fillOpacity: palette.fillOpacity }
            : { fill: 'none' };
        const key = `${layer}-${i}`;
        switch (el.t) {
            case 'p':
                return <path key={key} d={el.d} transform={el.tf} {...fillProps} />;
            case 'pg':
                return <polygon key={key} points={el.points} {...fillProps} />;
            case 'c':
                return <circle key={key} cx={el.cx} cy={el.cy} r={el.r} {...fillProps} />;
            case 'e':
                return <ellipse key={key} cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...fillProps} />;
            case 'r':
                return <rect key={key} x={el.x} y={el.y} width={el.w} height={el.h} rx={el.rx} transform={el.tf} {...fillProps} />;
        }
    });
}

/** Icône néon verre générique (template 240×240, ton bleu ou vert). */
export const NeonIcon: React.FC<{
    glyph: NeonGlyphName;
    tone?: NeonTone;
    className?: string;
    'data-testid'?: string;
}> = ({ glyph, tone = 'blue', className, ...rest }) => {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const glassId = `neonGlass${uid}`;
    const topId = `neonTop${uid}`;
    const bottomId = `neonBottom${uid}`;
    const sheenId = `neonSheen${uid}`;
    const clipId = `neonClip${uid}`;
    const glyphDef = GLYPHS[glyph];
    const palette = TONES[tone];
    const glyphTf = `translate(120 120) scale(${glyphDef.scale}) translate(-120 -120)`;

    return (
        <svg
            viewBox="0 0 240 240"
            className={`neon-icon tone-${tone}${className ? ` ${className}` : ''}`}
            aria-hidden="true"
            data-testid={rest['data-testid']}
        >
            <defs>
                <linearGradient id={glassId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={palette.glassA} stopOpacity="0.32" />
                    <stop offset="50%" stopColor={palette.glassB} stopOpacity="0.16" />
                    <stop offset="100%" stopColor={palette.glassC} stopOpacity="0.30" />
                </linearGradient>
                <linearGradient id={topId} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.58" />
                    <stop offset="60%" stopColor="#ffffff" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
                <linearGradient id={bottomId} x1="0%" y1="100%" x2="0%" y2="0%">
                    <stop offset="0%" stopColor={palette.bottom} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={palette.bottom} stopOpacity="0" />
                </linearGradient>
                <linearGradient id={sheenId} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
                <clipPath id={clipId}>
                    <rect x="36" y="36" width="168" height="168" rx="34" />
                </clipPath>
            </defs>

            {/* 1. Fond de verre */}
            <rect x="36" y="36" width="168" height="168" rx="34" fill={`url(#${glassId})`} />

            {/* 2. Reflets de verre + sheen de survol */}
            <g clipPath={`url(#${clipId})`}>
                <path d="M 30 30 L 210 30 L 210 82 Q 120 105 30 82 Z" fill={`url(#${topId})`} />
                <path d="M 30 210 L 210 210 L 210 182 Q 120 168 30 182 Z" fill={`url(#${bottomId})`} />
                <rect x="38" y="38" width="164" height="164" rx="32" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.5" />
                <rect className="neon-sheen" x="36" y="36" width="168" height="168" rx="34" fill={`url(#${sheenId})`} opacity="0" />
            </g>

            {/* 3. Bordure néon (couleur/glow pilotés par CSS selon l'état) */}
            <g className="neon-border">
                <rect className="neon-tube" x="32" y="32" width="176" height="176" rx="38" fill="none" strokeWidth="4" />
                <rect className="neon-core" x="32" y="32" width="176" height="176" rx="38" fill="none" strokeWidth="1.6" />
                <rect className="neon-inner" x="38.5" y="38.5" width="163" height="163" rx="32" fill="none" strokeWidth="1.4" />
            </g>

            {/* 4. Glyph central : lueur d'accent + cœur blanc */}
            <g className="neon-glyph" strokeLinecap="round" strokeLinejoin="round">
                <g className="glyph-under" transform={glyphTf}>{renderGlyphEls(glyphDef.els, 'under', palette)}</g>
                <g className="glyph-core" transform={glyphTf}>{renderGlyphEls(glyphDef.els, 'core', palette)}</g>
            </g>
        </svg>
    );
};

/** Onglet de la modale de configuration agent (ton bleu, charte TabIconBlurNeon). */
const TabIconNeon: React.FC<{
    name: AgentTabIconName;
    className?: string;
    'data-testid'?: string;
}> = ({ name, className, ...rest }) => (
    <NeonIcon glyph={name} tone="blue" className={className} data-testid={rest['data-testid']} />
);

export default TabIconNeon;
