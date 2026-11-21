import React, { useId } from 'react';

/**
 * ⭐ NodeHandleSphere — poignée de connexion des nodes agent (haut gauche/droite) :
 * petite sphère lumineuse en fausse 3D, SVG inline. La teinte de base est la **couleur du
 * robot créateur du node** (prop `color`, ex. violet BOS #8b5cf6) ; au repos la sphère est
 * **très sombre** (dégradé de la couleur assombrie + halo faible via la var CSS
 * `--sphere-rest-glow` posée inline sur le <svg>).
 *
 * États (CSS dans index.css, sur .node-handle-sphere) :
 * - repos    : sphère sombre couleur créateur, halo `2px var(--sphere-rest-glow)`
 * - :hover   : s'agrandit légèrement (scale 1.18) + halo renforcé (luminosité retrouvée)
 * - :active / .connecting (classe posée par React Flow pendant le tracé d'un edge) :
 *   plus brillante (halo blanc/indigo clair fort), jusqu'à la connexion à une autre poignée
 *
 * L'id du dégradé est uniquifié par useId (plusieurs sphères sur le canvas).
 */

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

/** Mélange `hex` vers blanc (amt=1) ou noir (amt=1) ; amt=0 -> hex inchangé. */
const mix = (hex: string, target: 'white' | 'black', amt: number): string => {
    const { r, g, b } = hexToRgb(hex);
    const t = target === 'white' ? 255 : 0;
    const m = (v: number) => Math.round(v + (t - v) * amt);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
};

const rgba = (hex: string, a: number): string => {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
};

const DEFAULT_COLOR = '#6366f1'; // indigo (fallback)

const NodeHandleSphere: React.FC<{ className?: string; color?: string }> = ({ className = '', color = DEFAULT_COLOR }) => {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const gradId = `sphereGrad${uid}`;

    // Dégradé **très sombre** de la couleur du créateur : on assombrit partout,
    // seul un léger reflet clair en haut à gauche rappelle la teinte.
    const cLight = mix(color, 'white', 0.1);
    const cMid = mix(color, 'black', 0.35);
    const cBase = mix(color, 'black', 0.6);
    const cDark = mix(color, 'black', 0.85);
    const ring = mix(color, 'white', 0.3);

    return (
        <svg
            viewBox="0 0 32 32"
            className={`node-handle-sphere ${className}`}
            width="100%"
            height="100%"
            aria-hidden="true"
            style={{ ['--sphere-rest-glow' as any]: rgba(color, 0.3) }}
        >
            <defs>
                <radialGradient id={gradId} cx="35%" cy="30%" r="78%">
                    <stop offset="0%" stopColor={cLight} />
                    <stop offset="30%" stopColor={cMid} />
                    <stop offset="62%" stopColor={cBase} />
                    <stop offset="100%" stopColor={cDark} />
                </radialGradient>
            </defs>
            {/* sphère (très sombre au repos, couleur du robot créateur) */}
            <circle cx="16" cy="16" r="12.5" fill={`url(#${gradId})`} />
            {/* reflet spéculaire (effet 3D) */}
            <ellipse cx="11.5" cy="10.5" rx="4.6" ry="3.2" fill="#ffffff" opacity="0.18" transform="rotate(-24 11.5 10.5)" />
            {/* anneau de bord */}
            <circle cx="16" cy="16" r="12.5" fill="none" stroke={ring} strokeOpacity="0.18" strokeWidth="1" />
        </svg>
    );
};

export default NodeHandleSphere;
