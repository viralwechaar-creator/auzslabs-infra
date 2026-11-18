#pragma once
#include <Arduino.h>   
#include "OneButton.h"
#include "PWR_Key.h"

#define BOOT_KEY_PIN     0

#define Button_PIN1   BOOT_KEY_PIN
#define Button_PIN2   PWR_KEY_Input_PIN    

typedef enum {
  None = 0,               // no-operation
  Click = 1,              // Click
  DoubleClick = 2,        // DoubleClick
  LongPressStart = 3,     // LongPressStart
} Status_Button;
                
extern Status_Button BOOT_KEY_State;                
extern Status_Button PWR_KEY_State;

void Button_Init(void);                                           
void ButtonTask(void *parameter);                                

// 1
void LongPressStart1(void *oneButton);                             
void Click1(void *oneButton);                                    
void DoubleClick1(void *oneButton);  
// 2
void LongPressStart2(void *oneButton);                             
void Click2(void *oneButton);                                    
void DoubleClick2(void *oneButton);                                