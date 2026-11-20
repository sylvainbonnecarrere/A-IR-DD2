import React, { useId } from 'react';

/**
 * ⭐ NodeHandleSphere — poignée de connexion des nodes agent (haut gauche/droite) :
 * petite sphère lumineuse en fausse 3D, SVG inline, teinte de base violet tirant sur le
 * bleu (indigo Archi #6366F1, dégradé sombre #818cf8 → #1e1b4b).
 *
 * États (CSS dans index.css, sur .node-handle-sphere) :
 * - repos    : sphère indigo **très sombre** + halo à peine visible
 * - :hover   : s'agrandit légèrement (scale 1.18) + halo renforcé (luminosité retrouvée)
 * - .connecting (classe posée par React Flow pendant le tracé d'un edge) : plus brillante,
 *   jusqu'à ce que la poignée soit connectée à une autre (l'edge apparaît, la classe disparaît)
 *
 * L'id du dégradé est uniquifié par useId (plusieurs spheres sur le canvas).
 */
const NodeHandleSphere: React.FC<{ className?: string }> = ({ className = '' }) => {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const gradId = `sphereGrad${uid}`;

    return (
        <svg
            viewBox="0 0 32 32"
            className={`node-handle-sphere ${className}`}
            width="100%"
            height="100%"
            aria-hidden="true"
        >
            <defs>
                <radialGradient id={gradId} cx="35%" cy="30%" r="78%">
                    <stop offset="0%" stopColor="#818cf8" />
                    <stop offset="30%" stopColor="#6366f1" />
                    <stop offset="62%" stopColor="#4338ca" />
                    <stop offset="100%" stopColor="#1e1b4b" />
                </radialGradient>
            </defs>
            {/* sphère (sombre au repos) */}
            <circle cx="16" cy="16" r="12.5" fill={`url(#${gradId})`} />
            {/* reflet spéculaire (effet 3D) */}
            <ellipse cx="11.5" cy="10.5" rx="4.6" ry="3.2" fill="#ffffff" opacity="0.55" transform="rotate(-24 11.5 10.5)" />
            {/* anneau de bord */}
            <circle cx="16" cy="16" r="12.5" fill="none" stroke="#a5b4fc" strokeOpacity="0.3" strokeWidth="1" />
        </svg>
    );
};

export default NodeHandleSphere;
