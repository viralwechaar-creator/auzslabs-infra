#include "PWR_Key.h"



void PWR_Loop(void)
{
  if(PWR_KEY_State == LongPressStart){   
    PWR_KEY_State = None;
    Shutdown(); 
  }
}

void Shutdown(void)
{
  digitalWrite(PWR_Control_PIN, LOW);
  LCD_Backlight = 0;        
}
void PWR_Init(void) { 
  pinMode(PWR_Control_PIN, OUTPUT);
  digitalWrite(PWR_Control_PIN, LOW);
  vTaskDelay(100);
  if(!digitalRead(PWR_KEY_Input_PIN)) {           
    digitalWrite(PWR_Control_PIN, HIGH);
  }
}
