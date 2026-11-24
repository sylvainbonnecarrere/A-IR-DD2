import { RobotId, PrototypeType, GovernanceValidationResult, ROBOT_CREATION_RIGHTS } from '../types';

/**
 * Service de Gouvernance V2 - Validation des droits de création par robot
 *
 * Selon le plan architectural CrewAI + N8N, chaque robot a des mandats spécifiques :
 * - Archi : Création d'agents et orchestration
 * - Com : Gestion des connexions API et authentification  
 * - Phil : Transformation de données et validation de fichiers
 * - Tim : Événements temporels et planification
 * - Bos : Supervision et monitoring (lecture seule)
 *
 * Ce service garantit que seuls les robots autorisés peuvent créer/modifier
 * les prototypes correspondant à leur domaine de compétence.
 */
export class GovernanceService {
  /**
   * Valide si un robot peut effectuer une opération sur un type de prototype
   */
  static validateRobotPermission(
    robotId: RobotId,
    prototypeType: PrototypeType,
    operation: 'create' | 'modify' | 'delete',
  ): GovernanceValidationResult {
    const capabilities = ROBOT_CREATION_RIGHTS[robotId];

    if (!capabilities) {
      return {
        isValid: false,
        error: `Robot ${robotId} non reconnu dans le système de gouvernance`,
        robotId,
        prototypeType,
        operation,
      };
    }

    let hasPermission = false;

    switch (operation) {
      case 'create':
        hasPermission = capabilities.canCreate.includes(prototypeType);
        break;
      case 'modify':
        hasPermission = capabilities.canModify.includes(prototypeType);
        break;
      case 'delete':
        hasPermission = capabilities.canDelete.includes(prototypeType);
        break;
    }

    if (!hasPermission) {
      const allowedTypes = capabilities[`can${operation.charAt(0).toUpperCase() + operation.slice(1)}` as keyof typeof capabilities];
      return {
        isValid: false,
        error: `Robot ${robotId} ne peut pas ${operation} les prototypes de type '${prototypeType}'. Types autorisés : ${allowedTypes.join(', ') || 'aucun'}`,
        robotId,
        prototypeType,
        operation,
      };
    }

    return {
      isValid: true,
      robotId,
      prototypeType,
      operation,
    };
  }

  /**
   * Valide si un creator_id correspond au robot autorisé pour ce type
   */
  static validateCreatorId(creatorId: RobotId, prototypeType: PrototypeType): boolean {
    const validation = this.validateRobotPermission(creatorId, prototypeType, 'create');
    return validation.isValid;
  }

  /**
   * Retourne les types de prototypes qu'un robot peut créer
   */
  static getAllowedPrototypeTypes(robotId: RobotId): PrototypeType[] {
    const capabilities = ROBOT_CREATION_RIGHTS[robotId];
    return capabilities ? capabilities.canCreate : [];
  }

  /**
   * Retourne le robot autorisé à créer un type de prototype donné
   */
  static getAuthorizedRobot(prototypeType: PrototypeType): RobotId | null {
    for (const [robotId, capabilities] of Object.entries(ROBOT_CREATION_RIGHTS)) {
      if (capabilities.canCreate.includes(prototypeType)) {
        return robotId as RobotId;
      }
    }
    return null;
  }

  /**
   * Génère un message d'erreur convivial pour l'utilisateur
   */
  static getPermissionErrorMessage(robotId: RobotId, prototypeType: PrototypeType, operation: 'create' | 'modify' | 'delete'): string {
    const authorizedRobot = this.getAuthorizedRobot(prototypeType);
    const operationText = operation === 'create' ? 'créer' : operation === 'modify' ? 'modifier' : 'supprimer';

    return (
      `❌ **Accès refusé**\n\n` +
      `Le robot **${robotId}** ne peut pas ${operationText} les prototypes de type **${prototypeType}**.\n\n` +
      `${authorizedRobot ? `Seul le robot **${authorizedRobot}** est autorisé pour cette opération.` : "Aucun robot n'est autorisé pour cette opération."}`
    );
  }

  /**
   * Hook de validation pour les opérations CRUD sur les prototypes
   */
  static enforceGovernance<T extends { creator_id: RobotId }>(
    prototype: T,
    prototypeType: PrototypeType,
    operation: 'create' | 'modify' | 'delete',
    currentRobotId: RobotId,
  ): { success: boolean; error?: string; data?: T } {
    // Valider que le robot actuel a les droits
    const validation = this.validateRobotPermission(currentRobotId, prototypeType, operation);

    if (!validation.isValid) {
      return {
        success: false,
        error: this.getPermissionErrorMessage(currentRobotId, prototypeType, operation),
      };
    }

    // Pour les opérations de création, s'assurer que creator_id correspond au robot autorisé
    if (operation === 'create') {
      if (prototype.creator_id !== currentRobotId) {
        return {
          success: false,
          error: `Le creator_id (${prototype.creator_id}) doit correspondre au robot actuel (${currentRobotId})`,
        };
      }
    }

    // Validation réussie
    return {
      success: true,
      data: prototype,
    };
  }
}

/**
 * Hooks React pour la gouvernance (à utiliser dans les composants)
 */
export const useGovernance = () => {
  const validateOperation = (robotId: RobotId, prototypeType: PrototypeType, operation: 'create' | 'modify' | 'delete') => {
    return GovernanceService.validateRobotPermission(robotId, prototypeType, operation);
  };

  const canCreate = (robotId: RobotId, prototypeType: PrototypeType) => {
    return GovernanceService.validateRobotPermission(robotId, prototypeType, 'create').isValid;
  };

  const canModify = (robotId: RobotId, prototypeType: PrototypeType) => {
    return GovernanceService.validateRobotPermission(robotId, prototypeType, 'modify').isValid;
  };

  const canDelete = (robotId: RobotId, prototypeType: PrototypeType) => {
    return GovernanceService.validateRobotPermission(robotId, prototypeType, 'delete').isValid;
  };

  return {
    validateOperation,
    canCreate,
    canModify,
    canDelete,
    getAllowedTypes: GovernanceService.getAllowedPrototypeTypes,
    getAuthorizedRobot: GovernanceService.getAuthorizedRobot,
    getErrorMessage: GovernanceService.getPermissionErrorMessage,
  };
};
