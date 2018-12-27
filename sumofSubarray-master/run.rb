def sub_arrays(array, len)
  array.sort! # Array should be sorted

  first_index = -1
  sec_index = -1

  sum1 = []
  sum2 = []
  sum3 = []

  # sum of array
  sum = array.inject(:+)

  # return invalid if sum can't be divided into 3 parts
  return false unless (sum % 3).zero?

  # s1 is sum of 1st subarray
  # s2 is sum of 1st and 2nd subarray
  s1 = sum / 3
  s2 = 2 * s1

  temp_sum = 0

  (0...len).each do |i|
    temp_sum += array[i]

    unless temp_sum.zero?
      if (temp_sum % s1).zero? && first_index == -1
        first_index = i
      elsif (temp_sum % s2).zero?
        sec_index = i
        break
      end
    end
  end

  if first_index != -1 && sec_index != -1

    (0..first_index).each { |n| sum1 << array[n] }
    (first_index + 1..sec_index).each { |n| sum2 << array[n] }
    (sec_index + 1...len).each { |n| sum3 << array[n] }

    puts sum1.join(',')
    puts sum2.join(',')
    puts sum3.join(',')
    return true
  end

  false
end

# array = [1, 3, 4, 0, 4]
array = [4, 3, 4, 0, 1]
# array = [2,2,2,2,2,2]
puts 'invalid input' unless sub_arrays(array, array.length)
