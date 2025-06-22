export const decapitalizeFirstLetter = (str: string) =>
  str.charAt(0).toLocaleLowerCase() + str.slice(1);
