export interface FormationFailure {
  code: string
  category: string
  phase: 'source' | 'prepare' | 'provider' | 'parse' | 'submit' | 'settle' | 'interrupted' | 'unknown'
}
export function formationFailure(value: unknown, phase?: FormationFailure['phase']): FormationFailure
export function validFormationFailure(value: unknown): value is FormationFailure
export function automaticFormationRetry(failure: FormationFailure): boolean
