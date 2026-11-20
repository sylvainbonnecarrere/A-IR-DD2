import React from 'react';

import { useDesignStore } from '../stores/useDesignStore';
import { useLocalization } from '../hooks/useLocalization';

/**
 * ⭐ Uniformisation graphique des headers de pages robot (2026-11-20) :
 * `RobotIndicator` = bloc standard « Robot Actuel » avec le nom/id du robot, coloré selon
 * la couleur du robot. À afficher dans le header de TOUTES les pages robot.
 *
 * Les classes sont littérales (lookup) pour que Tailwind les compile.
 */

export type RobotColor = 'blue' | 'green' | 'yellow' | 'red' | 'indigo';

// Charte robot (2026-11-20) : BOS=jaune, COM=vert, PHIL=bleu, TIM=rouge, ARCHI=indigo
const ROBOT_INDICATOR_CLASSES: Record<RobotColor, { block: string; label: string; name: string; sub: string }> = {
    blue: { block: 'bg-blue-500/20 border-blue-500/30', label: 'text-blue-300', name: 'text-blue-100', sub: 'text-blue-400' },
    green: { block: 'bg-green-500/20 border-green-500/30', label: 'text-green-300', name: 'text-green-100', sub: 'text-green-400' },
    yellow: { block: 'bg-yellow-500/20 border-yellow-500/30', label: 'text-yellow-300', name: 'text-yellow-100', sub: 'text-yellow-400' },
    red: { block: 'bg-red-500/20 border-red-500/30', label: 'text-red-300', name: 'text-red-100', sub: 'text-red-400' },
    indigo: { block: 'bg-indigo-500/20 border-indigo-500/30', label: 'text-indigo-300', name: 'text-indigo-100', sub: 'text-indigo-400' },
};

// RobotId (enum) -> clé i18n du nom affiché du robot
const ROBOT_NAME_KEY: Record<string, string> = {
    AR_001: 'robot_archi_name',
    BO_002: 'robot_bos_name',
    CO_003: 'robot_com_name',
    PH_004: 'robot_phil_name',
    TI_005: 'robot_tim_name',
};

export const RobotIndicator: React.FC<{
    color: RobotColor;
    /** robot de la page (RobotId) — OBLIGATOIRE : le currentRobotId du store peut ne pas
     *  correspondre à la page affichée ; le nom affiché est dérivé de ce robotId */
    robotId?: string;
    /** sous-titre optionnel (ex. spécialité du robot) */
    subtitle?: string;
    /** nom affiché (défaut : nom i18n du robotId) */
    name?: string;
    className?: string;
}> = ({ color, robotId, subtitle, name, className = '' }) => {
    const { t } = useLocalization();
    // ⭐ Forme sans sélecteur (compatible avec les mocks de tests qui retournent l'objet d'état entier)
    const designState = useDesignStore() as { currentRobotId?: string | null } | undefined;
    const effectiveRobotId = robotId ?? designState?.currentRobotId ?? undefined;
    const classes = ROBOT_INDICATOR_CLASSES[color];
    const nameKey = effectiveRobotId ? ROBOT_NAME_KEY[effectiveRobotId] : undefined;
    const displayName = name ?? (nameKey ? t(nameKey) : effectiveRobotId);

    return (
        <div
            className={`${classes.block} border rounded-lg px-3 py-1.5 whitespace-nowrap ${className}`}
            data-testid="robot-indicator"
            data-robot-color={color}
        >
            <div className={`text-xs font-medium ${classes.label}`}>{t('current_robot_label')}</div>
            <div className={`text-sm font-bold ${classes.name}`}>{displayName}</div>
            {subtitle ? <div className={`text-xs ${classes.sub}`}>{subtitle}</div> : null}
        </div>
    );
};

export default RobotIndicator;
