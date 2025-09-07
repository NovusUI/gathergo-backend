import { registerDecorator, ValidationOptions } from 'class-validator';

export function IsDateAfterMinutes(
  minutes: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isDateAfterMinutes',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [minutes],
      validator: {
        validate(value: any) {
          if (!value) return true;
          const date = new Date(value);
          const now = new Date();
          now.setMinutes(now.getMinutes() + minutes);
          return date > now;
        },
        defaultMessage() {
          return `${propertyName} must be at least ${minutes} minutes from now`;
        },
      },
    });
  };
}
