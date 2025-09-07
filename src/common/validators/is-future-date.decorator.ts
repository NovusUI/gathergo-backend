import {
    registerDecorator,
    ValidationOptions,
    ValidationArguments,
  } from 'class-validator';
  
  export function IsAtLeast20MinInFuture(validationOptions?: ValidationOptions) {
    return function (object: Object, propertyName: string) {
      registerDecorator({
        name: 'isAtLeast20MinInFuture',
        target: object.constructor,
        propertyName,
        options: validationOptions,
        validator: {
          validate(value: any) {
            const date = new Date(value);
            const now = new Date();
            const twentyMinLater = new Date(now.getTime() + 20 * 60 * 1000);
  
            return !isNaN(date.getTime()) && date > twentyMinLater;
          },
          defaultMessage(args: ValidationArguments) {
            return `${args.property} must be at least 20 minutes in the future`;
          },
        },
      });
    };
  }
  