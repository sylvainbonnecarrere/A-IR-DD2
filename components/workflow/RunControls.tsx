import React from 'react';

import { NeonIcon, type NeonGlyphName } from '../agent-tabs/TabIconNeon';

import { useLocalization } from '../../hooks/useLocalization';

/**
 * ⭐ Contrôles de run de la carte workflow : 3 boutons icônes néon vert (charte TabIconBlurNeon,
 * ton green) — play / pause / stop, SANS texte, groupés (gap-1).
 *
 * - play remplace l'ancien bouton « Exécuter » (même handler, mêmes règles de policy) ;
 * - pause et stop sont volontairement NON opérationnels pour l'instant (désactivés) :
 *   le contrat serveur V2 n'expose pas encore pause/resume/checkpoint (cf. backlog US-J7-02).
 * - Au survol ET au clic, seul le GLYPHE CENTRAL change de couleur (bordure et reflets inchangés) :
 *   play → vert pomme #8DB600, pause → jaune #FACC15, stop → rouge #EF4444
 *   (via la variable CSS --glyph-accent posée sur chaque bouton).
 * - Infobulle au survol : même style que la diode « canal temps réel » (classe .info-bubble).
 * - bloc de largeur FIXE (3 × w-10 h-10, flex-shrink-0) : la position des boutons ne bouge pas
 *   quand l'état du workflow change.
 */

interface RunControlsProps {
    onRun: () => void;
    canRun: boolean;
    isLaunching: boolean;
    className?: string;
}

interface RunControlDef {
    glyph: NeonGlyphName;
    labelKey: string;
    testId: string;
    accent: string;
    bubbleKey?: string;
    disabled?: boolean;
    comingSoon?: boolean;
}

const ACCENTS = {
    play: '#8DB600', // vert pomme
    pause: '#FACC15', // jaune
    stop: '#EF4444', // rouge
} as const;

export const RunControls: React.FC<RunControlsProps> = ({ onRun, canRun, isLaunching, className = '' }) => {
    const { t } = useLocalization();

    const comingSoon = t('workflow.runControlsComingSoon');

    const controls: RunControlDef[] = [
        { glyph: 'play', labelKey: 'workflow.execute', testId: 'run-play-button', accent: ACCENTS.play, bubbleKey: 'workflow.runControlsPlay' },
        { glyph: 'pause', labelKey: 'workflow.pause', testId: 'run-pause-button', accent: ACCENTS.pause, disabled: true, comingSoon: true },
        { glyph: 'stop', labelKey: 'workflow.stop', testId: 'run-stop-button', accent: ACCENTS.stop, disabled: true, comingSoon: true },
    ];

    return (
        <div
            className={`flex items-center gap-1 flex-shrink-0 ${className}`}
            data-testid="run-controls"
        >
            {controls.map((control) => {
                // aria-label seul (pas d'attribut title) : on ne doit voir QUE l'infobulle au survol,
                // pas le tooltip natif du navigateur en plus.
                const ariaLabel = control.comingSoon
                    ? `${t(control.labelKey)} — ${comingSoon}`
                    : t(control.labelKey);
                const bubbleText = control.bubbleKey
                    ? t(control.bubbleKey)
                    : ariaLabel;
                const disabled = control.disabled || (!control.disabled && (!canRun || isLaunching));
                return (
                    <button
                        key={control.glyph}
                        type="button"
                        onClick={control.glyph === 'play' ? onRun : undefined}
                        disabled={disabled}
                        className="run-control-btn relative group w-10 h-10"
                        style={{ '--glyph-accent': control.accent } as React.CSSProperties}
                        aria-label={ariaLabel}
                        data-testid={control.testId}
                    >
                        <NeonIcon glyph={control.glyph} tone="green" className="w-full h-full" />
                        {/* Infobulle au survol : style standard .info-bubble (identique à la diode « canal temps réel ») */}
                        <span className="info-bubble" data-testid={`${control.testId}-bubble`}>
                            <span className="font-semibold text-gray-100">{bubbleText}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
};

export default RunControls;
