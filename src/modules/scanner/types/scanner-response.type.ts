export type ScanResult = {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
};

export type ValidationResult = {
  isValid: boolean;
  message: string;
  data?: any;
};
