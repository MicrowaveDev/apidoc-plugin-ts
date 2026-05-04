export interface UserInput extends Record<string, any> {
  /**
   * Public login.
   */
  login: string
  /**
   * User password.
   */
  password: string
}

/**
 * @api {post} /api/login
 * @apiInterface {UserInput} apiBody
 * @apiGroup geesomeApiBodyRecord
 */
export function login () {
  return false
}
